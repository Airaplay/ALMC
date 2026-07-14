import { useState, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { LoadingLogo } from '../../components/LoadingLogo';

export const TermsAndConditionsScreen = (): JSX.Element => {
  const navigate = useNavigate();
  const { type } = useParams<{ type: string }>();
  const [termsContent, setTermsContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTerms();
  }, [type]);

  const fetchTerms = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const termsType = type === 'user-signup' ? 'user_signup' : 'artist_registration';
      
      const { data, error } = await supabase.rpc('get_active_terms', {
        terms_type: termsType
      });

      if (error) throw error;
      setTermsContent(data || '');
    } catch (err) {
      console.error('Error fetching terms:', err);
      setError('Failed to load terms and conditions. Please try again later.');
      setTermsContent('');
    } finally {
      setIsLoading(false);
    }
  };

  const getTitle = () => {
    return type === 'user-signup' 
      ? 'User Signup Terms & Conditions' 
      : 'Artist Registration Terms & Conditions';
  };

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] text-white content-with-nav overflow-y-auto">
      <header className="w-full py-4 px-5 sticky top-0 z-20 bg-gradient-to-b from-[#1a1a1a] to-transparent backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            aria-label="Go back"
            className="p-2 hover:bg-white/10 rounded-full transition-all"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="font-bold text-lg">{getTitle()}</h1>
          <div className="w-10"></div>
        </div>
      </header>

      <div className="px-5 py-6 flex-1">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <LoadingLogo variant="pulse" size={48} />
            <p className="mt-4 text-white/60">Loading terms...</p>
          </div>
        ) : error ? (
          <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-4">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        ) : (
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6">
            <pre className="text-white/80 text-sm whitespace-pre-wrap font-sans leading-relaxed">
              {termsContent || 'Terms and conditions are currently unavailable. Please contact support.'}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};

