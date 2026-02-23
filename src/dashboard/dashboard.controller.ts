import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('api/dashboard')
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get()
  async getStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('accountId') accountId?: string,
    @Query('objective') objective?: string,
  ) {
    return this.dashboardService.getStats(startDate, endDate, accountId, objective);
  }
}
