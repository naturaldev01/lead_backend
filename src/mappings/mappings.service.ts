import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { CreateMappingDto, UpdateMappingDto } from './dto/mapping.dto';

@Injectable()
export class MappingsService {
  private readonly logger = new Logger(MappingsService.name);

  constructor(private supabaseService: SupabaseService) {}

  async getMappings() {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from('mappings')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('Failed to fetch mappings', error);
      throw error;
    }

    return (data || []).map((mapping) => ({
      id: mapping.id,
      name: mapping.name,
      rules: mapping.rules || [],
      createdAt: mapping.created_at,
      updatedAt: mapping.updated_at,
    }));
  }

  async createMapping(dto: CreateMappingDto) {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from('mappings')
      .insert({
        name: dto.name,
        rules: dto.rules,
      })
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to create mapping', error);
      throw error;
    }

    return {
      id: data.id,
      name: data.name,
      rules: data.rules || [],
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  async updateMapping(id: string, dto: UpdateMappingDto) {
    const supabase = this.supabaseService.getClient();

    const updateData: any = { updated_at: new Date().toISOString() };
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.rules !== undefined) updateData.rules = dto.rules;

    const { data, error } = await supabase
      .from('mappings')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to update mapping', error);
      throw error;
    }

    if (!data) {
      throw new NotFoundException('Mapping not found');
    }

    return {
      id: data.id,
      name: data.name,
      rules: data.rules || [],
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  async deleteMapping(id: string) {
    const supabase = this.supabaseService.getClient();

    const { error } = await supabase
      .from('mappings')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error('Failed to delete mapping', error);
      throw error;
    }
  }
}
