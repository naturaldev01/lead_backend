#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://huftlaoyxetncdkpelkj.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1ZnRsYW95eGV0bmNka3BlbGtqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTU4MjUwMCwiZXhwIjoyMDg3MTU4NTAwfQ.1RlikN7joKJgRyDycj-CDxXUuOoPvT37y0j4enFtcXc';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function normalizeFieldName(name) {
  return name.toLowerCase().replace(/[\s_-]+/g, '');
}

async function backfillMappedFields() {
  console.log('Backfilling mapped_field_name for existing records...\n');

  // Get all mappings
  const { data: mappings, error: mappingError } = await supabase
    .from('field_mappings')
    .select('raw_field_name, mapped_field');

  if (mappingError) {
    console.error('Error fetching mappings:', mappingError.message);
    console.log('\nNote: You need to create the field_mappings table first.');
    console.log('Run: node scripts/create-field-mappings-table.js');
    return;
  }

  if (!mappings || mappings.length === 0) {
    console.log('No mappings found. Run: node scripts/seed-field-mappings.js');
    return;
  }

  console.log(`Found ${mappings.length} field mappings`);

  // Create normalized lookup
  const mappingLookup = new Map();
  for (const m of mappings) {
    const normalized = normalizeFieldName(m.raw_field_name);
    mappingLookup.set(normalized, m.mapped_field);
  }

  // Get all unique field names from lead_field_data
  const { data: fieldNames, error: fieldError } = await supabase
    .from('lead_field_data')
    .select('field_name')
    .is('mapped_field_name', null);

  if (fieldError) {
    console.error('Error fetching field data:', fieldError.message);
    return;
  }

  const uniqueFieldNames = [...new Set(fieldNames.map(f => f.field_name))];
  console.log(`Found ${uniqueFieldNames.length} unique field names to process\n`);

  let updated = 0;
  let skipped = 0;

  for (const fieldName of uniqueFieldNames) {
    const normalized = normalizeFieldName(fieldName);
    const mappedField = mappingLookup.get(normalized);

    if (mappedField) {
      const { error: updateError, count } = await supabase
        .from('lead_field_data')
        .update({ mapped_field_name: mappedField })
        .eq('field_name', fieldName)
        .is('mapped_field_name', null);

      if (updateError) {
        console.log(`✗ Error updating "${fieldName}": ${updateError.message}`);
      } else {
        console.log(`✓ ${fieldName} -> ${mappedField}`);
        updated++;
      }
    } else {
      console.log(`- ${fieldName} (no mapping found)`);
      skipped++;
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log('BACKFILL COMPLETED');
  console.log(`${'='.repeat(50)}`);
  console.log(`Updated: ${updated} field types`);
  console.log(`Skipped (no mapping): ${skipped} field types`);
}

backfillMappedFields().catch(console.error);
