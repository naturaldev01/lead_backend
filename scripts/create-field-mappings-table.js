const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function createTable() {
  console.log('Attempting to create field_mappings table...\n');
  
  // Unfortunately, Supabase JS client doesn't support raw DDL queries
  // The table needs to be created via Supabase Dashboard SQL Editor
  
  console.log('='.repeat(60));
  console.log('PLEASE RUN THIS SQL IN SUPABASE SQL EDITOR:');
  console.log('='.repeat(60));
  console.log(`
-- Create field_mappings table
CREATE TABLE IF NOT EXISTS field_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    raw_field_name VARCHAR(255) NOT NULL UNIQUE,
    mapped_field VARCHAR(100) NOT NULL,
    language VARCHAR(10),
    auto_detected BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_field_mappings_raw ON field_mappings(raw_field_name);
CREATE INDEX IF NOT EXISTS idx_field_mappings_mapped ON field_mappings(mapped_field);

-- Add mapped_field_name column to lead_field_data
ALTER TABLE lead_field_data ADD COLUMN IF NOT EXISTS mapped_field_name VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_lead_field_data_mapped ON lead_field_data(mapped_field_name);

-- Enable RLS but allow all for now
ALTER TABLE field_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON field_mappings FOR ALL USING (true);
  `);
  console.log('='.repeat(60));
  
  // Test if table exists
  const { data, error } = await supabase
    .from('field_mappings')
    .select('id')
    .limit(1);
  
  if (error && (error.code === 'PGRST205' || error.message.includes('does not exist'))) {
    console.log('\n❌ Table does not exist yet. Please create it using the SQL above.');
  } else if (error) {
    console.log('\n❌ Error:', error.message);
  } else {
    console.log('\n✅ Table already exists!');
  }
}

createTable();
