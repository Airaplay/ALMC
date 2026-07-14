/*
  # Add Listener Curations and Tracks Blowing Up Promotion Sections
  
  1. New Promotion Sections
    - listener_curations: Promotional slots for listener-curated playlists section
    - tracks_blowing_up: Promotional slots for tracks blowing up section
    
  2. Key Requirements
    - ONE promotion per section (fair rotation)
    - Integrated with existing promotion system
    - Available in Admin Dashboard Promotion Manager
    
  3. Sort Order
    - Positioned after existing sections
    - Listener Curations: sort_order 60
    - Tracks Blowing Up: sort_order 70
*/

-- Insert Listener Curations promotion section
INSERT INTO promotion_sections (section_name, section_key, description, is_active, sort_order)
VALUES (
  'Listener Curations',
  'listener_curations',
  'Promote playlists in the Listener Curations section (one slot, fair rotation)',
  true,
  60
)
ON CONFLICT (section_key) DO UPDATE SET
  section_name = EXCLUDED.section_name,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order;

-- Insert Tracks Blowing Up promotion section
INSERT INTO promotion_sections (section_name, section_key, description, is_active, sort_order)
VALUES (
  'Tracks Blowing Up',
  'tracks_blowing_up',
  'Promote songs in the Tracks Blowing Up section (one slot, fair rotation)',
  true,
  70
)
ON CONFLICT (section_key) DO UPDATE SET
  section_name = EXCLUDED.section_name,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order;

-- Grant necessary permissions
GRANT SELECT ON promotion_sections TO authenticated, anon;

-- Add helpful comments
COMMENT ON COLUMN promotion_sections.sort_order IS 'Display order for admin dashboard and dropdown lists';
