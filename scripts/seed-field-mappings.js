#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://huftlaoyxetncdkpelkj.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1ZnRsYW95eGV0bmNka3BlbGtqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTU4MjUwMCwiZXhwIjoyMDg3MTU4NTAwfQ.1RlikN7joKJgRyDycj-CDxXUuOoPvT37y0j4enFtcXc';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const INITIAL_MAPPINGS = [
  // Email variations
  { raw_field_name: 'email', mapped_field: 'email', language: 'en' },
  { raw_field_name: 'e-mail', mapped_field: 'email', language: 'en' },
  { raw_field_name: 'email_address', mapped_field: 'email', language: 'en' },
  { raw_field_name: 'e-mail-adresse', mapped_field: 'email', language: 'de' },
  { raw_field_name: 'emailadresse', mapped_field: 'email', language: 'de' },
  { raw_field_name: 'indirizzo_email', mapped_field: 'email', language: 'it' },
  { raw_field_name: 'correo', mapped_field: 'email', language: 'es' },
  { raw_field_name: 'correo_electronico', mapped_field: 'email', language: 'es' },
  { raw_field_name: 'mail', mapped_field: 'email', language: 'en' },
  { raw_field_name: 'e-posta', mapped_field: 'email', language: 'tr' },

  // Phone variations
  { raw_field_name: 'phone', mapped_field: 'phone', language: 'en' },
  { raw_field_name: 'phone_number', mapped_field: 'phone', language: 'en' },
  { raw_field_name: 'telefon', mapped_field: 'phone', language: 'tr' },
  { raw_field_name: 'telefonnummer', mapped_field: 'phone', language: 'de' },
  { raw_field_name: 'tel', mapped_field: 'phone', language: 'en' },
  { raw_field_name: 'mobile', mapped_field: 'phone', language: 'en' },
  { raw_field_name: 'numero_di_telefono', mapped_field: 'phone', language: 'it' },
  { raw_field_name: 'telefono', mapped_field: 'phone', language: 'it' },
  { raw_field_name: 'numero_telefono', mapped_field: 'phone', language: 'it' },
  { raw_field_name: 'número_de_telefone', mapped_field: 'phone', language: 'pt' },
  { raw_field_name: 'numero_de_telefono', mapped_field: 'phone', language: 'es' },

  // Full name variations
  { raw_field_name: 'full_name', mapped_field: 'full_name', language: 'en' },
  { raw_field_name: 'full name', mapped_field: 'full_name', language: 'en' },
  { raw_field_name: 'fullname', mapped_field: 'full_name', language: 'en' },
  { raw_field_name: 'name', mapped_field: 'full_name', language: 'en' },
  { raw_field_name: 'nome_completo', mapped_field: 'full_name', language: 'it' },
  { raw_field_name: 'nombre_completo', mapped_field: 'full_name', language: 'es' },
  { raw_field_name: 'vollständiger_name', mapped_field: 'full_name', language: 'de' },

  // First name variations
  { raw_field_name: 'first_name', mapped_field: 'first_name', language: 'en' },
  { raw_field_name: 'first name', mapped_field: 'first_name', language: 'en' },
  { raw_field_name: 'firstname', mapped_field: 'first_name', language: 'en' },
  { raw_field_name: 'vorname', mapped_field: 'first_name', language: 'de' },
  { raw_field_name: 'nome', mapped_field: 'first_name', language: 'it' },
  { raw_field_name: 'nombre', mapped_field: 'first_name', language: 'es' },

  // Last name variations
  { raw_field_name: 'last_name', mapped_field: 'last_name', language: 'en' },
  { raw_field_name: 'last name', mapped_field: 'last_name', language: 'en' },
  { raw_field_name: 'lastname', mapped_field: 'last_name', language: 'en' },
  { raw_field_name: 'surname', mapped_field: 'last_name', language: 'en' },
  { raw_field_name: 'nachname', mapped_field: 'last_name', language: 'de' },
  { raw_field_name: 'cognome', mapped_field: 'last_name', language: 'it' },
  { raw_field_name: 'apellido', mapped_field: 'last_name', language: 'es' },

  // City variations
  { raw_field_name: 'city', mapped_field: 'city', language: 'en' },
  { raw_field_name: 'town', mapped_field: 'city', language: 'en' },
  { raw_field_name: 'town/city', mapped_field: 'city', language: 'en' },
  { raw_field_name: 'stadt', mapped_field: 'city', language: 'de' },
  { raw_field_name: 'citta', mapped_field: 'city', language: 'it' },
  { raw_field_name: 'città', mapped_field: 'city', language: 'it' },
  { raw_field_name: 'ciudad', mapped_field: 'city', language: 'es' },
  { raw_field_name: 'cidade', mapped_field: 'city', language: 'pt' },
  { raw_field_name: 'ilce', mapped_field: 'city', language: 'tr' },
  { raw_field_name: 'district', mapped_field: 'city', language: 'en' },

  // Province/State variations
  { raw_field_name: 'province', mapped_field: 'province', language: 'en' },
  { raw_field_name: 'state', mapped_field: 'province', language: 'en' },
  { raw_field_name: 'region', mapped_field: 'province', language: 'en' },
  { raw_field_name: 'bundesland', mapped_field: 'province', language: 'de' },
  { raw_field_name: 'il', mapped_field: 'province', language: 'tr' },
  { raw_field_name: 'provincia', mapped_field: 'province', language: 'it' },

  // Country variations
  { raw_field_name: 'country', mapped_field: 'country', language: 'en' },
  { raw_field_name: 'land', mapped_field: 'country', language: 'de' },
  { raw_field_name: 'paese', mapped_field: 'country', language: 'it' },
  { raw_field_name: 'pais', mapped_field: 'country', language: 'es' },
  { raw_field_name: 'ulke', mapped_field: 'country', language: 'tr' },

  // Date of birth variations
  { raw_field_name: 'date_of_birth', mapped_field: 'date_of_birth', language: 'en' },
  { raw_field_name: 'dob', mapped_field: 'date_of_birth', language: 'en' },
  { raw_field_name: 'birthday', mapped_field: 'date_of_birth', language: 'en' },
  { raw_field_name: 'birth_date', mapped_field: 'date_of_birth', language: 'en' },
  { raw_field_name: 'geburtsdatum', mapped_field: 'date_of_birth', language: 'de' },
  { raw_field_name: 'data_di_nascita', mapped_field: 'date_of_birth', language: 'it' },
  { raw_field_name: 'fecha_de_nacimiento', mapped_field: 'date_of_birth', language: 'es' },
  { raw_field_name: 'data_de_nascimento', mapped_field: 'date_of_birth', language: 'pt' },

  // Comments variations
  { raw_field_name: 'comments', mapped_field: 'comments', language: 'en' },
  { raw_field_name: 'comment', mapped_field: 'comments', language: 'en' },
  { raw_field_name: 'notes', mapped_field: 'comments', language: 'en' },
  { raw_field_name: 'message', mapped_field: 'comments', language: 'en' },
  { raw_field_name: 'kommentar', mapped_field: 'comments', language: 'de' },
  { raw_field_name: 'commenti', mapped_field: 'comments', language: 'it' },
  { raw_field_name: 'comentarios', mapped_field: 'comments', language: 'es' },
];

async function seedMappings() {
  console.log('Seeding field mappings...\n');

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const mapping of INITIAL_MAPPINGS) {
    const { data, error } = await supabase
      .from('field_mappings')
      .upsert(mapping, { onConflict: 'raw_field_name' })
      .select();

    if (error) {
      console.log(`✗ Error inserting "${mapping.raw_field_name}": ${error.message}`);
      errors++;
    } else if (data && data.length > 0) {
      inserted++;
    } else {
      skipped++;
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log('SEED COMPLETED');
  console.log(`${'='.repeat(50)}`);
  console.log(`Inserted/Updated: ${inserted}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);
}

seedMappings().catch(console.error);
