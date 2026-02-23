import { Controller, Get, Post, Query } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';

@Controller('api/campaigns')
export class CampaignsController {
  constructor(private campaignsService: CampaignsService) {}

  @Get()
  async getCampaigns(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('accountId') accountId?: string,
    @Query('search') search?: string,
  ) {
    return this.campaignsService.getCampaigns(startDate, endDate, accountId, search);
  }

  @Get('hierarchy')
  async getHierarchy(
    @Query('accountId') accountId?: string,
    @Query('search') search?: string,
  ) {
    return this.campaignsService.getHierarchy(accountId, search);
  }

  @Post('sync')
  async syncCampaigns() {
    return this.campaignsService.syncFromMeta();
  }
}
