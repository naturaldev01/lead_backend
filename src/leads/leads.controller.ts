import { Controller, Get, Post, Param, Query, Res } from '@nestjs/common';
import { LeadsService } from './leads.service';
import type { Response } from 'express';

@Controller('api/leads')
export class LeadsController {
  constructor(private leadsService: LeadsService) {}

  @Get()
  async getLeads(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('accountId') accountId?: string,
    @Query('campaignId') campaignId?: string,
    @Query('formName') formName?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('includeFieldData') includeFieldData?: string,
  ) {
    return this.leadsService.getLeads(
      startDate,
      endDate,
      accountId,
      campaignId,
      formName,
      search,
      parseInt(page || '1', 10),
      parseInt(limit || '50', 10),
      includeFieldData === 'true',
    );
  }

  @Get('profiles')
  async getLeadProfiles(
    @Query('search') search?: string,
    @Query('country') country?: string,
    @Query('source') source?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.leadsService.getLeadProfilesWithFilters({
      search,
      country,
      source,
      status,
      page: parseInt(page || '1', 10),
      limit: parseInt(limit || '50', 10),
    });
  }

  @Get('profiles/filters')
  async getLeadProfilesFilterOptions() {
    return this.leadsService.getLeadProfilesFilterOptions();
  }

  @Get('profiles/export')
  async exportLeadProfilesCsv(
    @Query('search') search?: string,
    @Query('country') country?: string,
    @Query('source') source?: string,
    @Query('status') status?: string,
    @Res() res?: Response,
  ) {
    const csv = await this.leadsService.exportLeadProfilesCsv({
      search,
      country,
      source,
      status,
    });

    const fileName = `lead_profiles_${new Date().toISOString().slice(0, 10)}.csv`;
    res?.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res?.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res?.send(csv);
  }

  @Get(':id')
  async getLeadDetails(@Param('id') id: string) {
    return this.leadsService.getLeadDetails(id);
  }

  @Post(':id/sync')
  async syncLead(@Param('id') id: string) {
    return this.leadsService.syncLead(id);
  }
}
