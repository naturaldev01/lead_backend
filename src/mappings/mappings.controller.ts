import { Controller, Get, Post, Patch, Delete, Param, Body } from '@nestjs/common';
import { MappingsService } from './mappings.service';
import { CreateMappingDto, UpdateMappingDto } from './dto/mapping.dto';

@Controller('api/mappings')
export class MappingsController {
  constructor(private mappingsService: MappingsService) {}

  @Get()
  async getMappings() {
    return this.mappingsService.getMappings();
  }

  @Post()
  async createMapping(@Body() dto: CreateMappingDto) {
    return this.mappingsService.createMapping(dto);
  }

  @Patch(':id')
  async updateMapping(@Param('id') id: string, @Body() dto: UpdateMappingDto) {
    return this.mappingsService.updateMapping(id, dto);
  }

  @Delete(':id')
  async deleteMapping(@Param('id') id: string) {
    return this.mappingsService.deleteMapping(id);
  }
}
