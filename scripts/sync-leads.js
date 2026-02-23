#!/usr/bin/env node

/**
 * Standalone Lead Sync Script
 * 
 * Bu script Cursor/IDE'den bağımsız çalışır.
 * 
 * Kullanım:
 *   node scripts/sync-leads.js              # Tüm formları senkronize et
 *   node scripts/sync-leads.js --list       # Mevcut formları listele
 *   node scripts/sync-leads.js --form=ID    # Tek form senkronize et
 */

const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// Configuration from .env
const CONFIG = {
  META_API_VERSION: 'v19.0',
  META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN || 'EAANCZADF2M4EBQsZB7SObcvZCLLN0D7RuyLJwNq2C2uEN1j3VWncIBBZBOn2PW0ckFpPYM3XbZCaSNaUthm5ZCMZCTGu0l9fWBwlSfiyHFTp6MjAbL1r0ZBPBORql3khThjMhM0EiBmxLypCZCx5Ueo5DNPuXkqyeX7qd9ABZBlKGOTdWF3YJBBLAbBG8yjPk53wZDZD',
  SUPABASE_URL: process.env.SUPABASE_URL || 'https://huftlaoyxetncdkpelkj.supabase.co',
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1ZnRsYW95eGV0bmNka3BlbGtqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTU4MjUwMCwiZXhwIjoyMDg3MTU4NTAwfQ.1RlikN7joKJgRyDycj-CDxXUuOoPvT37y0j4enFtcXc',
};

const META_BASE_URL = `https://graph.facebook.com/${CONFIG.META_API_VERSION}`;
const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_SERVICE_KEY);

// Progress tracking
let stats = {
  totalFetched: 0,
  totalInserted: 0,
  totalSkipped: 0,
  formsProcessed: 0,
  errors: 0,
};

function log(message) {
  const timestamp = new Date().toISOString().substring(11, 19);
  console.log(`[${timestamp}] ${message}`);
}

function logProgress() {
  process.stdout.write(`\r  Progress: ${stats.totalFetched} fetched, ${stats.totalInserted} inserted, ${stats.totalSkipped} skipped    `);
}

async function getPages() {
  const response = await axios.get(`${META_BASE_URL}/me/accounts`, {
    params: {
      access_token: CONFIG.META_ACCESS_TOKEN,
      fields: 'id,name,access_token',
    },
  });
  return response.data.data || [];
}

async function getForms(pageId, pageAccessToken) {
  const response = await axios.get(`${META_BASE_URL}/${pageId}/leadgen_forms`, {
    params: {
      access_token: pageAccessToken,
      fields: 'id,name,status,leads_count',
    },
  });
  return response.data.data || [];
}

async function syncFormLeads(form, pageAccessToken) {
  log(`\nProcessing form: ${form.name} (ID: ${form.id})`);
  log(`  Expected leads: ${form.leads_count || 0}`);

  let nextUrl = `${META_BASE_URL}/${form.id}/leads?access_token=${pageAccessToken}&fields=id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id&limit=100`;
  let pageNum = 0;
  let formInserted = 0;
  let formFetched = 0;

  while (nextUrl) {
    pageNum++;
    
    try {
      const response = await axios.get(nextUrl);
      const leads = response.data.data || [];
      formFetched += leads.length;
      stats.totalFetched += leads.length;

      if (leads.length === 0) {
        nextUrl = response.data.paging?.next || null;
        continue;
      }

      // Check existing leads
      const leadIds = leads.map(l => l.id);
      const { data: existingLeads } = await supabase
        .from('leads')
        .select('lead_id')
        .in('lead_id', leadIds);

      const existingIds = new Set((existingLeads || []).map(l => l.lead_id));
      const newLeads = leads.filter(l => !existingIds.has(l.id));
      
      stats.totalSkipped += (leads.length - newLeads.length);

      if (newLeads.length > 0) {
        // Insert new leads
        const leadsToInsert = newLeads.map(lead => ({
          lead_id: lead.id,
          form_name: form.name,
          ad_name: lead.ad_name || null,
          ad_set_name: lead.adset_name || null,
          campaign_id: lead.campaign_id || null,
          source: 'sync',
          created_at: lead.created_time,
        }));

        const { data: insertedLeads, error: insertError } = await supabase
          .from('leads')
          .insert(leadsToInsert)
          .select();

        if (insertError) {
          log(`  ERROR inserting leads: ${insertError.message}`);
          stats.errors++;
        } else if (insertedLeads) {
          formInserted += insertedLeads.length;
          stats.totalInserted += insertedLeads.length;

          // Insert field data
          const fieldDataToInsert = [];
          for (let j = 0; j < insertedLeads.length; j++) {
            const originalLead = newLeads[j];
            if (originalLead.field_data) {
              for (const field of originalLead.field_data) {
                fieldDataToInsert.push({
                  lead_id: insertedLeads[j].id,
                  field_name: field.name,
                  field_value: field.values?.[0] || '',
                });
              }
            }
          }

          if (fieldDataToInsert.length > 0) {
            await supabase.from('lead_field_data').insert(fieldDataToInsert);
          }
        }
      }

      logProgress();
      nextUrl = response.data.paging?.next || null;

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (error) {
      log(`  ERROR on page ${pageNum}: ${error.message}`);
      stats.errors++;
      nextUrl = null;
    }
  }

  console.log(); // New line after progress
  log(`  Form completed: ${formFetched} fetched, ${formInserted} inserted`);
  stats.formsProcessed++;
}

async function listForms() {
  log('Fetching available forms...\n');
  
  const pages = await getPages();
  let totalForms = 0;
  let totalLeads = 0;

  for (const page of pages) {
    const forms = await getForms(page.id, page.access_token);
    const formsWithLeads = forms.filter(f => f.leads_count > 0);
    
    if (formsWithLeads.length > 0) {
      console.log(`\n📄 Page: ${page.name}`);
      for (const form of formsWithLeads) {
        console.log(`   • ${form.name}`);
        console.log(`     ID: ${form.id}`);
        console.log(`     Leads: ${form.leads_count}`);
        totalLeads += form.leads_count;
        totalForms++;
      }
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Total: ${totalForms} forms with ${totalLeads} leads`);
}

async function syncAllForms() {
  log('Starting full sync...\n');
  
  const startTime = Date.now();
  const pages = await getPages();
  log(`Found ${pages.length} pages`);

  // Collect all forms with leads
  const allForms = [];
  for (const page of pages) {
    const forms = await getForms(page.id, page.access_token);
    for (const form of forms) {
      if (form.leads_count > 0) {
        allForms.push({ form, pageAccessToken: page.access_token, pageName: page.name });
      }
    }
  }

  log(`Found ${allForms.length} forms with leads\n`);

  // Process each form
  for (let i = 0; i < allForms.length; i++) {
    const { form, pageAccessToken, pageName } = allForms[i];
    log(`\n[${ i + 1}/${allForms.length}] Page: ${pageName}`);
    await syncFormLeads(form, pageAccessToken);
  }

  // Log sync to database
  await supabase.from('sync_logs').insert({
    type: 'leads',
    status: 'success',
  });

  const duration = Math.round((Date.now() - startTime) / 1000);
  
  console.log(`\n${'='.repeat(50)}`);
  console.log('SYNC COMPLETED');
  console.log(`${'='.repeat(50)}`);
  console.log(`Duration: ${duration} seconds`);
  console.log(`Forms processed: ${stats.formsProcessed}`);
  console.log(`Total fetched: ${stats.totalFetched}`);
  console.log(`Total inserted: ${stats.totalInserted}`);
  console.log(`Total skipped (already exist): ${stats.totalSkipped}`);
  console.log(`Errors: ${stats.errors}`);
}

async function syncSingleForm(formId) {
  log(`Searching for form: ${formId}\n`);
  
  const pages = await getPages();
  
  for (const page of pages) {
    const forms = await getForms(page.id, page.access_token);
    const form = forms.find(f => f.id === formId);
    
    if (form) {
      await syncFormLeads(form, page.access_token);
      
      console.log(`\n${'='.repeat(50)}`);
      console.log('SYNC COMPLETED');
      console.log(`Total inserted: ${stats.totalInserted}`);
      return;
    }
  }

  log(`Form not found: ${formId}`);
}

async function main() {
  const args = process.argv.slice(2);
  
  console.log('');
  console.log('='.repeat(50));
  console.log('  META LEADS SYNC SCRIPT');
  console.log('='.repeat(50));
  console.log('');

  try {
    if (args.includes('--list')) {
      await listForms();
    } else if (args.find(a => a.startsWith('--form='))) {
      const formId = args.find(a => a.startsWith('--form=')).split('=')[1];
      await syncSingleForm(formId);
    } else {
      await syncAllForms();
    }
  } catch (error) {
    console.error('\nFATAL ERROR:', error.message);
    process.exit(1);
  }
}

main();
