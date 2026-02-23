const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://huftlaoyxetncdkpelkj.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1ZnRsYW95eGV0bmNka3BlbGtqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTU4MjUwMCwiZXhwIjoyMDg3MTU4NTAwfQ.1RlikN7joKJgRyDycj-CDxXUuOoPvT37y0j4enFtcXc'
);

async function runMigration() {
  // Test if columns exist by trying to select them
  const { data: testCampaign, error: testError } = await supabase
    .from('campaigns')
    .select('insights_leads_count, status')
    .limit(1);
  
  if (testError) {
    console.log('Columns do not exist yet. Please run this SQL in Supabase Dashboard:');
    console.log(`
-- Run this in Supabase SQL Editor:
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS insights_leads_count INTEGER DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE ad_sets ADD COLUMN IF NOT EXISTS insights_leads_count INTEGER DEFAULT 0;
ALTER TABLE ads ADD COLUMN IF NOT EXISTS insights_leads_count INTEGER DEFAULT 0;
    `);
    return false;
  }
  
  console.log('Columns already exist!');
  return true;
}

runMigration().then(result => {
  console.log('Migration check completed:', result);
  process.exit(result ? 0 : 1);
});
