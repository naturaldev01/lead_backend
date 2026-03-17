import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { CohortService } from './cohort.service';
import { SpendRevenueService } from './spend-revenue.service';
import { PerformanceService } from './performance.service';

@Controller('api/dashboard')
export class DashboardController {
  constructor(
    private dashboardService: DashboardService,
    private cohortService: CohortService,
    private spendRevenueService: SpendRevenueService,
    private performanceService: PerformanceService,
  ) {}

  @Get()
  async getStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('accountId') accountId?: string,
    @Query('objective') objective?: string,
  ) {
    return this.dashboardService.getStats(
      startDate,
      endDate,
      accountId,
      objective,
    );
  }

  @Get('v2')
  async getStatsV2(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('accountId') accountId?: string,
    @Query('objective') objective?: string,
    @Query('country') country?: string,
    @Query('service') service?: string,
    @Query('campaign') campaign?: string,
    @Query('language') language?: string,
  ) {
    return this.dashboardService.getStatsV2({
      startDate,
      endDate,
      accountId,
      objective,
      country,
      service,
      campaign,
      language,
    });
  }

  @Get('cohort-revenue')
  async getCohortRevenue(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('accountId') accountId?: string,
    @Query('cohortStartDate') cohortStartDate?: string,
    @Query('cohortEndDate') cohortEndDate?: string,
    @Query('maxMonths') maxMonths?: string,
  ) {
    return this.cohortService.getCohortRevenue(
      startDate,
      endDate,
      accountId,
      cohortStartDate,
      cohortEndDate,
      maxMonths ? parseInt(maxMonths) : undefined,
    );
  }

  @Get('lead-trend')
  async getLeadTrend(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('accountId') accountId?: string,
    @Query('granularity') granularity?: 'day' | 'week' | 'month',
  ) {
    return this.cohortService.getLeadTrend(
      startDate,
      endDate,
      accountId,
      granularity || 'month',
    );
  }

  @Get('spend-vs-revenue')
  async getSpendVsRevenue(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('accountId') accountId?: string,
  ) {
    return this.spendRevenueService.getSpendVsRevenue(startDate, endDate, accountId);
  }

  @Get('revenue-by-deal-date')
  async getRevenueByDealDate(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('accountId') accountId?: string,
  ) {
    return this.spendRevenueService.getRevenueByDealDate(startDate, endDate, accountId);
  }

  @Get('campaign-performance')
  async getCampaignPerformance(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('accountId') accountId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.performanceService.getCampaignPerformance(
      startDate,
      endDate,
      accountId,
      limit ? parseInt(limit) : 10,
    );
  }

  @Get('service-performance')
  async getServicePerformance(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('accountId') accountId?: string,
  ) {
    return this.performanceService.getServicePerformance(startDate, endDate, accountId);
  }

  @Get('creative-performance')
  async getCreativePerformance(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('accountId') accountId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.performanceService.getCreativePerformance(
      startDate,
      endDate,
      accountId,
      limit ? parseInt(limit) : 10,
    );
  }

  @Get('funnel-snapshot')
  async getFunnelSnapshot(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('accountId') accountId?: string,
  ) {
    return this.performanceService.getFunnelSnapshot(startDate, endDate, accountId);
  }
}
