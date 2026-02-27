#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://huftlaoyxetncdkpelkj.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1ZnRsYW95eGV0bmNka3BlbGtqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTU4MjUwMCwiZXhwIjoyMDg3MTU4NTAwfQ.1RlikN7joKJgRyDycj-CDxXUuOoPvT37y0j4enFtcXc';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function runMigration() {
  console.log('Running migration 002: Field Mappings...\n');

  try {
    // Create field_mappings table
    const { error: tableError } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE TABLE IF NOT EXISTS field_mappings (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            raw_field_name VARCHAR(255) NOT NULL UNIQUE,
            mapped_field VARCHAR(100) NOT NULL,
            language VARCHAR(10),
            auto_detected BOOLEAN DEFAULT false,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `
    });

    if (tableError) {
      // Try direct insert to test if table exists
      const { error: testError } = await supabase
        .from('field_mappings')
        .select('id')
        .limit(1);
      
      if (testError && testError.code === '42P01') {
        console.log('Table does not exist. Please run this SQL in Supabase Dashboard:\n');
        console.log(`
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

ALTER TABLE lead_field_data ADD COLUMN IF NOT EXISTS mapped_field_name VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_lead_field_data_mapped ON lead_field_data(mapped_field_name);
        `);
        return;
      }
    }

    // Test if table exists now
    const { data: testData, error: checkError } = await supabase
      .from('field_mappings')
      .select('id')
      .limit(1);

    if (checkError && checkError.code === '42P01') {
      console.log('field_mappings table does not exist.');
      console.log('Please create it manually in Supabase Dashboard with the SQL above.');
      return;
    }

    console.log('✓ field_mappings table exists or was created');

    // Check if mapped_field_name column exists in lead_field_data
    const { data: fieldData, error: fieldError } = await supabase
      .from('lead_field_data')
      .select('mapped_field_name')
      .limit(1);

    if (fieldError && fieldError.message.includes('mapped_field_name')) {
      console.log('mapped_field_name column does not exist.');
      console.log('Please add it manually in Supabase Dashboard:');
      console.log('ALTER TABLE lead_field_data ADD COLUMN mapped_field_name VARCHAR(100);');
      return;
    }

    console.log('✓ mapped_field_name column exists in lead_field_data');
    console.log('\nMigration check completed successfully!');

  } catch (error) {
    console.error('Error:', error.message);
  }
}

runMigration();
