/*
  # Create FAQs table for admin-managed help content

  1. New Tables
    - `faqs` - Store frequently asked questions and answers
      - `id` (uuid, primary key)
      - `question` (text, required)
      - `answer` (text, required)
      - `category` (text, optional for grouping)
      - `order` (integer, for display order)
      - `is_active` (boolean, to show/hide FAQs)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on faqs table
    - Public read access for active FAQs
    - Admin-only write access (for future admin dashboard)

  3. Sample Data
    - Insert some default FAQs to get started
*/

-- Create faqs table
CREATE TABLE IF NOT EXISTS faqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL,
  answer text NOT NULL,
  category text DEFAULT 'general',
  order_index integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable Row Level Security (RLS)
ALTER TABLE faqs ENABLE ROW LEVEL SECURITY;

-- Allow public read access to active FAQs
CREATE POLICY "Public can read active FAQs"
ON faqs
FOR SELECT
TO public
USING (is_active = true);

-- Allow admins to manage FAQs (for future admin dashboard)
CREATE POLICY "Admins can manage FAQs"
ON faqs
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users 
    WHERE id = auth.uid() 
    AND role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users 
    WHERE id = auth.uid() 
    AND role = 'admin'
  )
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_faqs_active ON faqs(is_active);
CREATE INDEX IF NOT EXISTS idx_faqs_category ON faqs(category);
CREATE INDEX IF NOT EXISTS idx_faqs_order ON faqs(order_index);

-- Insert sample FAQs
INSERT INTO faqs (question, answer, category, order_index) VALUES
(
  'How do I upload music to the platform?',
  'To upload music, go to the Create section in the app. If you''re a listener, you can upload short clips. To upload full songs and albums, you need to become an artist first by completing the artist registration process.',
  'uploading',
  1
),
(
  'How do earnings work?',
  'You earn money when people stream your content, add your music to playlists, or send you tips. Earnings are calculated based on plays and engagement. You can withdraw your earnings once you reach the minimum threshold of $10 and have added a valid USDT wallet address.',
  'earnings',
  2
),
(
  'How can I become a verified artist?',
  'Verified artist status is granted based on several factors including content quality, engagement, and authenticity. Keep uploading quality content and building your audience. Our team reviews artists for verification regularly.',
  'verification',
  3
),
(
  'What file formats are supported?',
  'For audio: MP3, WAV, FLAC. For videos: MP4, MOV, WebM. For images: JPEG, PNG, WebP. Maximum file sizes vary by content type - check the upload guidelines for specific limits.',
  'technical',
  4
),
(
  'How do I add a wallet address for withdrawals?',
  'Go to your Profile > Earnings tab and click on "USDT Wallet Address". Enter your USDT wallet address (supports TRC-20, ERC-20, and Bitcoin formats). This is required to withdraw your earnings.',
  'earnings',
  5
);

-- Function to get active FAQs by category
CREATE OR REPLACE FUNCTION get_faqs_by_category(category_filter text DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  question text,
  answer text,
  category text,
  order_index integer
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    f.id,
    f.question,
    f.answer,
    f.category,
    f.order_index
  FROM faqs f
  WHERE f.is_active = true
    AND (category_filter IS NULL OR f.category = category_filter)
  ORDER BY f.order_index ASC, f.created_at ASC;
END;
$$;

-- Grant execute permission to public
GRANT EXECUTE ON FUNCTION get_faqs_by_category TO public;