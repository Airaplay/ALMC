/*
  # Enable Realtime for Users Table
  
  1. Changes
    - Enable realtime updates for users table
    - Allows frontend to subscribe to total_earnings changes
    - Live Balance updates automatically when rewards are distributed
  
  2. Impact
    - Profile screen will show Live Balance updates in real-time
    - No page refresh needed when earnings change
*/

-- Enable realtime for users table
ALTER PUBLICATION supabase_realtime ADD TABLE users;