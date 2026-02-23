const axios = require('axios');

const META_API_VERSION = 'v19.0';
const META_ACCESS_TOKEN = 'EAANCZADF2M4EBQsZB7SObcvZCLLN0D7RuyLJwNq2C2uEN1j3VWncIBBZBOn2PW0ckFpPYM3XbZCaSNaUthm5ZCMZCTGu0l9fWBwlSfiyHFTp6MjAbL1r0ZBPBORql3khThjMhM0EiBmxLypCZCx5Ueo5DNPuXkqyeX7qd9ABZBlKGOTdWF3YJBBLAbBG8yjPk53wZDZD';
const BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

async function testMetaAPI() {
  console.log('=== META API TEST ===\n');

  try {
    // 1. Get Pages
    console.log('1. Fetching pages...');
    const pagesResponse = await axios.get(`${BASE_URL}/me/accounts`, {
      params: {
        access_token: META_ACCESS_TOKEN,
        fields: 'id,name,access_token',
      },
    });
    const pages = pagesResponse.data.data || [];
    console.log(`   Found ${pages.length} pages`);

    let totalLeadsCount = 0;
    let totalFormsCount = 0;

    for (const page of pages) {
      console.log(`\n   Page: ${page.name} (${page.id})`);

      // 2. Get Lead Gen Forms for each page
      try {
        const formsResponse = await axios.get(`${BASE_URL}/${page.id}/leadgen_forms`, {
          params: {
            access_token: page.access_token,
            fields: 'id,name,status,leads_count',
          },
        });
        const forms = formsResponse.data.data || [];
        console.log(`   Forms: ${forms.length}`);
        totalFormsCount += forms.length;

        for (const form of forms) {
          console.log(`\n      Form: ${form.name}`);
          console.log(`      ID: ${form.id}`);
          console.log(`      Status: ${form.status}`);
          console.log(`      Leads Count (from Meta): ${form.leads_count || 0}`);
          totalLeadsCount += form.leads_count || 0;

          // 3. Test pagination - get actual leads count
          let actualLeadsCount = 0;
          let nextUrl = `${BASE_URL}/${form.id}/leads?access_token=${page.access_token}&fields=id&limit=500`;

          while (nextUrl) {
            const leadsResponse = await axios.get(nextUrl);
            actualLeadsCount += (leadsResponse.data.data || []).length;
            nextUrl = leadsResponse.data.paging?.next || null;
            
            // Safety limit
            if (actualLeadsCount >= 50000) {
              console.log(`      (Stopped at 50000 for safety)`);
              break;
            }
          }
          console.log(`      Actual Leads (via pagination): ${actualLeadsCount}`);
        }
      } catch (error) {
        console.log(`   Error fetching forms: ${error.response?.data?.error?.message || error.message}`);
      }
    }

    console.log('\n=== SUMMARY ===');
    console.log(`Total Pages: ${pages.length}`);
    console.log(`Total Forms: ${totalFormsCount}`);
    console.log(`Total Leads (from leads_count): ${totalLeadsCount}`);

  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

testMetaAPI();
