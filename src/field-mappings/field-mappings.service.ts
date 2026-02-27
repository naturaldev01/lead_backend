import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { CreateFieldMappingDto, UpdateFieldMappingDto, FieldMapping, UnmappedField } from './dto/field-mapping.dto';

@Injectable()
export class FieldMappingsService {
  private readonly logger = new Logger(FieldMappingsService.name);
  private mappingCache: Map<string, string> = new Map();
  private cacheLoaded = false;

  constructor(private supabaseService: SupabaseService) {}

  private normalizeFieldName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[\s_\-]+/g, '')
      .replace(/[''`´]/g, "'")  // Normalize quote characters
      .replace(/[""]/g, '"');   // Normalize double quote characters
  }

  async loadCache(): Promise<void> {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('field_mappings')
      .select('raw_field_name, mapped_field');

    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205' || error.message.includes('does not exist') || error.message.includes('field_mappings')) {
        this.logger.warn('field_mappings table does not exist yet - cache empty');
        this.cacheLoaded = true;
        return;
      }
      this.logger.error(`Failed to load mappings cache: ${error.message}`);
      return;
    }

    this.mappingCache.clear();
    for (const mapping of data || []) {
      const normalized = this.normalizeFieldName(mapping.raw_field_name);
      this.mappingCache.set(normalized, mapping.mapped_field);
    }
    this.cacheLoaded = true;
    this.logger.log(`Loaded ${this.mappingCache.size} field mappings into cache`);
  }

  async getMappedFieldName(rawFieldName: string): Promise<string | null> {
    if (!this.cacheLoaded) {
      await this.loadCache();
    }

    const normalized = this.normalizeFieldName(rawFieldName);
    return this.mappingCache.get(normalized) || null;
  }

  async getAll(): Promise<FieldMapping[]> {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('field_mappings')
      .select('*')
      .order('mapped_field', { ascending: true });

    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205' || error.message.includes('does not exist') || error.message.includes('field_mappings')) {
        this.logger.warn('field_mappings table does not exist yet');
        return [];
      }
      this.logger.error(`Failed to get mappings: ${error.message}`);
      throw error;
    }

    return data || [];
  }

  async getById(id: string): Promise<FieldMapping | null> {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('field_mappings')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    return data;
  }

  async create(dto: CreateFieldMappingDto): Promise<FieldMapping> {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('field_mappings')
      .insert({
        raw_field_name: dto.rawFieldName,
        mapped_field: dto.mappedField,
        language: dto.language || null,
        auto_detected: dto.autoDetected || false,
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to create mapping: ${error.message}`);
      throw error;
    }

    // Refresh cache
    const normalized = this.normalizeFieldName(dto.rawFieldName);
    this.mappingCache.set(normalized, dto.mappedField);

    return data;
  }

  async update(id: string, dto: UpdateFieldMappingDto): Promise<FieldMapping> {
    const supabase = this.supabaseService.getClient();
    
    const updateData: Record<string, unknown> = {};
    if (dto.rawFieldName !== undefined) updateData.raw_field_name = dto.rawFieldName;
    if (dto.mappedField !== undefined) updateData.mapped_field = dto.mappedField;
    if (dto.language !== undefined) updateData.language = dto.language;
    if (dto.autoDetected !== undefined) updateData.auto_detected = dto.autoDetected;

    const { data, error } = await supabase
      .from('field_mappings')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to update mapping: ${error.message}`);
      throw error;
    }

    // Refresh cache
    await this.loadCache();

    return data;
  }

  async delete(id: string): Promise<void> {
    const supabase = this.supabaseService.getClient();
    const { error } = await supabase
      .from('field_mappings')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error(`Failed to delete mapping: ${error.message}`);
      throw error;
    }

    // Refresh cache
    await this.loadCache();
  }

  async getUnmappedFields(): Promise<UnmappedField[]> {
    const supabase = this.supabaseService.getClient();

    // Get all unique field names from lead_field_data
    const { data: fieldData, error: fieldError } = await supabase
      .from('lead_field_data')
      .select('field_name, field_value')
      .limit(10000);

    if (fieldError) {
      this.logger.error(`Failed to get field data: ${fieldError.message}`);
      return [];
    }

    // Get all mapped field names
    const { data: mappings, error: mappingError } = await supabase
      .from('field_mappings')
      .select('raw_field_name');

    if (mappingError) {
      if (mappingError.code === '42P01' || mappingError.code === 'PGRST205' || mappingError.message.includes('does not exist') || mappingError.message.includes('field_mappings')) {
        this.logger.warn('field_mappings table does not exist yet');
      } else {
        this.logger.error(`Failed to get mappings: ${mappingError.message}`);
      }
    }

    const mappedNormalized = new Set(
      (mappings || []).map(m => this.normalizeFieldName(m.raw_field_name))
    );

    // Group by field name and find unmapped
    const fieldGroups: Record<string, { count: number; values: Set<string> }> = {};

    for (const field of fieldData || []) {
      const normalized = this.normalizeFieldName(field.field_name);
      if (mappedNormalized.has(normalized)) continue;

      if (!fieldGroups[field.field_name]) {
        fieldGroups[field.field_name] = { count: 0, values: new Set() };
      }
      fieldGroups[field.field_name].count++;
      if (fieldGroups[field.field_name].values.size < 3) {
        fieldGroups[field.field_name].values.add(field.field_value || '');
      }
    }

    return Object.entries(fieldGroups)
      .map(([fieldName, { count, values }]) => ({
        fieldName,
        count,
        sampleValues: Array.from(values),
      }))
      .sort((a, b) => b.count - a.count);
  }

  async getStandardFields(): Promise<string[]> {
    return [
      'email',
      'phone',
      'full_name',
      'first_name',
      'last_name',
      'city',
      'province',
      'country',
      'date_of_birth',
      'comments',
      'job_experience',
      'salary_expectations',
      'languages',
      'work_onsite',
    ];
  }
}
