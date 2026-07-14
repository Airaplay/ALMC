import { supabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface PaymentStatusUpdate {
  payment_id: string;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  amount: number;
  package_id: string;
  completed_at?: string;
}

export class PaymentMonitor {
  private channel: RealtimeChannel | null = null;
  private callbacks: Map<string, (update: PaymentStatusUpdate) => void> = new Map();

  subscribe(paymentId: string, callback: (update: PaymentStatusUpdate) => void): () => void {
    this.callbacks.set(paymentId, callback);

    if (!this.channel) {
      this.setupChannel();
    }

    return () => {
      this.callbacks.delete(paymentId);
      if (this.callbacks.size === 0 && this.channel) {
        this.channel.unsubscribe();
        this.channel = null;
      }
    };
  }

  private async setupChannel() {
    // Get current user to filter payments
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    this.channel = supabase
      .channel('treat_payments_changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'treat_payments',
          filter: `user_id=eq.${user.id}` // Only listen to current user's payments
        },
        (payload) => {
          const update = payload.new as PaymentStatusUpdate;
          const callback = this.callbacks.get(update.payment_id);

          if (callback && update.status !== 'pending') {
            callback(update);
          }
        }
      )
      .subscribe();
  }

  async triggerVerificationIfStuck(paymentId: string): Promise<void> {
    // Wait 30 seconds after payment creation
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    // Check if still pending
    const { data } = await supabase
      .from('treat_payments')
      .select('status')
      .eq('id', paymentId)
      .maybeSingle();
    
    if (data && data.status === 'pending') {
      // Trigger verification via Edge Function
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session && supabaseUrl) {
        try {
          console.log(`[PaymentMonitor] Triggering auto-verification for payment ${paymentId}`);
          const response = await fetch(`${supabaseUrl}/functions/v1/reconcile-payments?payment_id=${paymentId}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
          });
          
          if (response.ok) {
            const result = await response.json();
            console.log(`[PaymentMonitor] Auto-verification result:`, result);
          } else {
            console.error(`[PaymentMonitor] Auto-verification failed: ${response.status}`);
          }
        } catch (error) {
          console.error('[PaymentMonitor] Auto-verification error:', error);
        }
      }
    }
  }

  async pollPaymentStatus(paymentId: string, maxAttempts = 30): Promise<PaymentStatusUpdate | null> {
    // Start auto-verification in background (non-blocking)
    this.triggerVerificationIfStuck(paymentId).catch(error => {
      console.error('[PaymentMonitor] Background verification error:', error);
    });

    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const { data, error } = await supabase
          .from('treat_payments')
          .select('id, status, amount, package_id, completed_at')
          .eq('id', paymentId)
          .maybeSingle();

        if (error) {
          console.error('Error polling payment status:', error);
          return null;
        }

        if (data && data.status !== 'pending') {
          return {
            payment_id: data.id,
            status: data.status,
            amount: data.amount,
            package_id: data.package_id,
            completed_at: data.completed_at
          };
        }

        await new Promise(resolve => setTimeout(resolve, 2000));
        attempts++;
      } catch (error) {
        console.error('Error in payment polling:', error);
        return null;
      }
    }

    return null;
  }

  unsubscribeAll() {
    if (this.channel) {
      this.channel.unsubscribe();
      this.channel = null;
    }
    this.callbacks.clear();
  }
}

export const paymentMonitor = new PaymentMonitor();
