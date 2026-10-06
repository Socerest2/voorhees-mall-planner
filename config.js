/* Where the shared plan lives.
   Empty = the planner still works, but only in your own browser.

   To share a plan across the team, make a NEW Supabase project (a free one is
   plenty — do not reuse the NJCM project, this repo is public and its anon key
   goes public with it), run tools/schema.sql in the SQL editor, then paste the
   project URL and the anon/public key below. Both are safe to publish; what
   protects the data is the row-level security in schema.sql.

   Settings -> API in the Supabase dashboard has both values. */
window.PLANNER_CONFIG = {
  url: 'https://ffsbfyhvzbpuyeukoghh.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmc2JmeWh2emJwdXlldWtvZ2hoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzMTg4MDksImV4cCI6MjEwNjg5NDgwOX0.5HvCDswbOzAXZkg2feBlNIzpUS0R4myFrxN2-eiwt54',
  planId: 'voorhees', // which shared plan this page edits
  pollSeconds: 6,     // how often to look for other people's saves
};
