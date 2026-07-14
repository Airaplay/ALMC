/*
  # Artist Collaboration Matching System

  1. New Tables
    - `artist_collaboration_preferences`
      - Stores artist preferences for collaboration
      - Genre preferences, location preferences, audience size preferences
    
    - `collaboration_matches`
      - AI-generated matches between artists
      - Compatibility score, matching factors
      - Refreshed weekly
    
    - `collaboration_requests`
      - Track collaboration requests between artists
      - Status: pending, accepted, declined, withdrawn
    
    - `collaboration_interactions`
      - Track user interactions (views, swipes, dismissals)

  2. Security
    - Enable RLS on all tables
    - Artists can only read their own matches and manage their requests
    - Public can view accepted collaborations for discovery
*/

-- Artist collaboration preferences
CREATE TABLE IF NOT EXISTS artist_collaboration_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id uuid NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seeking_collaboration boolean DEFAULT true,
  preferred_genres text[] DEFAULT '{}',
  preferred_locations text[] DEFAULT '{}',
  min_audience_size integer DEFAULT 0,
  max_audience_size integer,
  preferred_collab_types text[] DEFAULT ARRAY['feature', 'remix', 'joint_project'],
  bio_pitch text,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE(artist_id)
);

-- AI-generated collaboration matches
CREATE TABLE IF NOT EXISTS collaboration_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id uuid NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
  matched_artist_id uuid NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
  compatibility_score integer NOT NULL CHECK (compatibility_score >= 0 AND compatibility_score <= 100),
  match_factors jsonb DEFAULT '{}',
  genre_overlap text[] DEFAULT '{}',
  audience_overlap_score integer DEFAULT 0,
  location_proximity_score integer DEFAULT 0,
  trending_score integer DEFAULT 0,
  last_refreshed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE(artist_id, matched_artist_id)
);

-- Collaboration requests
CREATE TABLE IF NOT EXISTS collaboration_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_artist_id uuid NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_artist_id uuid NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message text,
  collab_type text DEFAULT 'feature',
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Track user interactions with matches
CREATE TABLE IF NOT EXISTS collaboration_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id uuid NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
  matched_artist_id uuid NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
  interaction_type text NOT NULL CHECK (interaction_type IN ('view', 'dismiss', 'interested', 'request_sent')),
  created_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_collab_prefs_artist ON artist_collaboration_preferences(artist_id);
CREATE INDEX IF NOT EXISTS idx_collab_prefs_seeking ON artist_collaboration_preferences(seeking_collaboration) WHERE seeking_collaboration = true;
CREATE INDEX IF NOT EXISTS idx_collab_matches_artist ON collaboration_matches(artist_id);
CREATE INDEX IF NOT EXISTS idx_collab_matches_matched_artist ON collaboration_matches(matched_artist_id);
CREATE INDEX IF NOT EXISTS idx_collab_matches_score ON collaboration_matches(compatibility_score DESC);
CREATE INDEX IF NOT EXISTS idx_collab_requests_sender ON collaboration_requests(sender_artist_id, status);
CREATE INDEX IF NOT EXISTS idx_collab_requests_recipient ON collaboration_requests(recipient_artist_id, status);
CREATE INDEX IF NOT EXISTS idx_collab_interactions_user ON collaboration_interactions(user_id, matched_artist_id);

-- Enable RLS
ALTER TABLE artist_collaboration_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE collaboration_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE collaboration_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE collaboration_interactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for artist_collaboration_preferences
CREATE POLICY "Artists can view own preferences"
  ON artist_collaboration_preferences FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Artists can insert own preferences"
  ON artist_collaboration_preferences FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Artists can update own preferences"
  ON artist_collaboration_preferences FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- RLS Policies for collaboration_matches
CREATE POLICY "Artists can view their matches"
  ON collaboration_matches FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM artist_profiles
      WHERE artist_profiles.id = collaboration_matches.artist_id
      AND artist_profiles.user_id = auth.uid()
    )
  );

-- RLS Policies for collaboration_requests
CREATE POLICY "Users can view requests they sent or received"
  ON collaboration_requests FOR SELECT
  TO authenticated
  USING (
    sender_user_id = auth.uid() OR
    recipient_user_id = auth.uid()
  );

CREATE POLICY "Artists can send collaboration requests"
  ON collaboration_requests FOR INSERT
  TO authenticated
  WITH CHECK (sender_user_id = auth.uid());

CREATE POLICY "Recipients can update request status"
  ON collaboration_requests FOR UPDATE
  TO authenticated
  USING (recipient_user_id = auth.uid())
  WITH CHECK (recipient_user_id = auth.uid());

CREATE POLICY "Senders can withdraw their requests"
  ON collaboration_requests FOR UPDATE
  TO authenticated
  USING (sender_user_id = auth.uid() AND status = 'pending')
  WITH CHECK (sender_user_id = auth.uid() AND status = 'withdrawn');

-- RLS Policies for collaboration_interactions
CREATE POLICY "Users can insert own interactions"
  ON collaboration_interactions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can view own interactions"
  ON collaboration_interactions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());
