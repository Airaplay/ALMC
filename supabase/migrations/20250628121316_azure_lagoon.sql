/*
  # Create FAQs system for Help & Support

  1. New Tables
    - `faqs` - Store frequently asked questions
      - `id` (uuid, primary key)
      - `question` (text, required)
      - `answer` (text, required)
      - `category` (text, default 'general')
      - `order_index` (integer, for ordering)
      - `is_active` (boolean, default true)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on faqs table
    - Public can read active FAQs
    - Only admins can manage FAQs

  3. Functions
    - `get_faqs_by_category` - Get FAQs filtered by category
*/

-- Create faqs table if it doesn't exist
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

-- Drop existing policies if they exist to avoid conflicts
DROP POLICY IF EXISTS "Public can read active FAQs" ON faqs;
DROP POLICY IF EXISTS "Admins can manage FAQs" ON faqs;

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

-- Insert sample FAQs only if the table is empty
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM faqs LIMIT 1) THEN
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
    ),
    (
      'Can I edit my uploads after publishing?',
      'Yes, you can edit certain details of your uploads like title, description, and cover art. Go to Library > My Uploads, find your content, and click the edit button. Note that some changes may require re-approval.',
      'uploading',
      6
    ),
    (
      'How long does it take to process withdrawals?',
      'Withdrawal processing typically takes 1-3 business days. You''ll receive a confirmation email once your withdrawal has been processed. Make sure your wallet address is correct as transactions cannot be reversed.',
      'earnings',
      7
    ),
    (
      'What are the content guidelines?',
      'All content must be original or properly licensed. No copyrighted material without permission. Content should be appropriate for all audiences. Spam, hate speech, or misleading content is not allowed.',
      'uploading',
      8
    ),
    (
      'How do I report a problem or bug?',
      'If you encounter any issues, please contact our support team at Airaplayintl@gmail.com with a detailed description of the problem, including screenshots if possible.',
      'technical',
      9
    ),
    (
      'Can I collaborate with other artists?',
      'Yes! You can collaborate by featuring other artists in your uploads. Make sure to properly credit all collaborators in your track information.',
      'general',
      10
    );
  END IF;
END $$;

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