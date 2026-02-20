import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { LeadsService } from './leads.service';

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
    );
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
