const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://huftlaoyxetncdkpelkj.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1ZnRsYW95eGV0bmNka3BlbGtqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTU4MjUwMCwiZXhwIjoyMDg3MTU4NTAwfQ.1RlikN7joKJgRyDycj-CDxXUuOoPvT37y0j4enFtcXc';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function checkDatabase() {
  console.log('=== DATABASE CHECK ===\n');

  // Check leads count
  const { count: leadsCount, error: leadsError } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true });

  if (leadsError) {
    console.log('Error fetching leads count:', leadsError.message);
  } else {
    console.log(`Total leads in database: ${leadsCount}`);
  }

  // Check leads by form
  const { data: leadsByForm, error: groupError } = await supabase
    .from('leads')
    .select('form_name');

  if (!groupError && leadsByForm) {
    const formCounts = {};
    leadsByForm.forEach(lead => {
      const name = lead.form_name || 'Unknown';
      formCounts[name] = (formCounts[name] || 0) + 1;
    });
    console.log('\nLeads by form:');
    Object.entries(formCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .forEach(([name, count]) => {
        console.log(`  ${name}: ${count}`);
      });
  }

  // Check sync logs
  const { data: syncLogs, error: syncError } = await supabase
    .from('sync_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  if (!syncError && syncLogs) {
    console.log('\nRecent sync logs:');
    syncLogs.forEach(log => {
      console.log(`  [${log.created_at}] ${log.type}: ${log.status} ${log.error_message || ''}`);
    });
  }

  // Check lead_field_data count
  const { count: fieldDataCount } = await supabase
    .from('lead_field_data')
    .select('*', { count: 'exact', head: true });

  console.log(`\nTotal lead_field_data entries: ${fieldDataCount}`);

  // Sample leads
  const { data: sampleLeads } = await supabase
    .from('leads')
    .select('*')
    .limit(5);

  if (sampleLeads && sampleLeads.length > 0) {
    console.log('\nSample lead:');
    console.log(JSON.stringify(sampleLeads[0], null, 2));
  }
}

checkDatabase();
