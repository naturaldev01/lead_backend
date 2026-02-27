import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { FieldMappingsService } from './field-mappings.service';
import { CreateFieldMappingDto, UpdateFieldMappingDto } from './dto/field-mapping.dto';

@Controller('api/field-mappings')
export class FieldMappingsController {
  constructor(private fieldMappingsService: FieldMappingsService) {}

  @Get()
  async getAll() {
    return this.fieldMappingsService.getAll();
  }

  @Get('unmapped')
  async getUnmapped() {
    return this.fieldMappingsService.getUnmappedFields();
  }

  @Get('standard-fields')
  async getStandardFields() {
    return this.fieldMappingsService.getStandardFields();
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.fieldMappingsService.getById(id);
  }

  @Post()
  async create(@Body() dto: CreateFieldMappingDto) {
    return this.fieldMappingsService.create(dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateFieldMappingDto) {
    return this.fieldMappingsService.update(id, dto);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    await this.fieldMappingsService.delete(id);
    return { success: true };
  }
}
