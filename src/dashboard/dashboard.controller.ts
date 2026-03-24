import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { CohortService } from './cohort.service';
import { SpendRevenueService } from './spend-revenue.service';
import { PerformanceService } from './performance.service';
import { CacheService } from '../common/cache.service';

@Controller('api/dashboard')
export class DashboardController {
  constructor(
    private dashboardService: DashboardService,
    private cohortService: CohortService,
    private spendRevenueService: SpendRevenueService,
    private performanceService: PerformanceService,
    private cacheService: CacheService,
  ) {}

  @Get()
  async getStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('accountId') accountId?: string,
    @Query('objective') objective?: string,
  ) {
    const cacheKey = this.cacheService.generateKey('dashboard:stats', {
      startDate,
      endDate,
      accountId,
      objective,
    });

    const cached = this.cacheService.get(cacheKey);
    if (cached) return cached;

    const result = await this.dashboardService.getStats(
      startDate,
      endDate,
      accountId,
      objective,
    );

    this.cacheService.set(cacheKey, result);
    return result;
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
    const cacheKey = this.cacheService.generateKey('dashboard:stats-v2', {
      startDate,
      endDate,
      accountId,
      objective,
      country,
      service,
      campaign,
      language,
    });

    const cached = this.cacheService.get(cacheKey);
    if (cached) return cached;

    const result = await this.dashboardService.getStatsV2({
      startDate,
      endDate,
      accountId,
      objective,
      country,
      service,
      campaign,
      language,
    });

    this.cacheService.set(cacheKey, result);
    return result;
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
    const cacheKey = this.cacheService.generateKey('dashboard:cohort-revenue', {
      startDate,
      endDate,
      accountId,
      cohortStartDate,
      cohortEndDate,
      maxMonths,
    });

    const cached = this.cacheService.get(cacheKey);
    if (cached) return cached;

    const result = await this.cohortService.getCohortRevenue(
      startDate,
      endDate,
      accountId,
      cohortStartDate,
      cohortEndDate,
      maxMonths ? parseInt(maxMonths) : undefined,
    );

    this.cacheService.set(cacheKey, result);
    return result;
  }

  @Get('lead-trend')
  async getLeadTrend(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('accountId') accountId?: string,
    @Query('granularity') granularity?: 'day' | 'week' | 'month',
  ) {
    const cacheKey = this.cacheService.generateKey('dashboard:lead-trend', {
      startDate,
      endDate,
      accountId,
      granularity,
    });

    const cached = this.cacheService.get(cacheKey);
    if (cached) return cached;

    const result = await this.cohortService.getLeadTrend(
      startDate,
      endDate,
      accountId,
      granularity || 'month',
    );

    this.cacheService.set(cacheKey, result);
    return result;
  }

  @Get('spend-vs-revenue')
  async getSpendVsRevenue(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('accountId') accountId?: string,
  ) {
    const cacheKey = this.cacheService.generateKey('dashboard:spend-vs-revenue', {
      startDate,
      endDate,
      accountId,
    });

    const cached = this.cacheService.get(cacheKey);
    if (cached) return cached;

    const result = await this.spendRevenueService.getSpendVsRevenue(
      startDate,
      endDate,
      accountId,
    );

    this.cacheService.set(cacheKey, result);
    return result;
  }

  @Get('revenue-by-deal-date')
  async getRevenueByDealDate(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('accountId') accountId?: string,
  ) {
    const cacheKey = this.cacheService.generateKey('dashboard:revenue-by-deal-date', {
      startDate,
      endDate,
      accountId,
    });

    const cached = this.cacheService.get(cacheKey);
    if (cached) return cached;

    const result = await this.spendRevenueService.getRevenueByDealDate(
      startDate,
      endDate,
      accountId,
    );

    this.cacheService.set(cacheKey, result);
    return result;
  }

  @Get('campaign-performance')
  async getCampaignPerformance(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('accountId') accountId?: string,
    @Query('limit') limit?: string,
  ) {
    const cacheKey = this.cacheService.generateKey('dashboard:campaign-performance', {
      startDate,
      endDate,
      accountId,
      limit,
    });

    const cached = this.cacheService.get(cacheKey);
    if (cached) return cached;

    const result = await this.performanceService.getCampaignPerformance(
      startDate,
      endDate,
      accountId,
      limit ? parseInt(limit) : 10,
    );

    this.cacheService.set(cacheKey, result);
    return result;
  }

  @Get('service-performance')
  async getServicePerformance(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('accountId') accountId?: string,
  ) {
    const cacheKey = this.cacheService.generateKey('dashboard:service-performance', {
      startDate,
      endDate,
      accountId,
    });

    const cached = this.cacheService.get(cacheKey);
    if (cached) return cached;

    const result = await this.performanceService.getServicePerformance(
      startDate,
      endDate,
      accountId,
    );

    this.cacheService.set(cacheKey, result);
    return result;
  }

  @Get('creative-performance')
  async getCreativePerformance(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('accountId') accountId?: string,
    @Query('limit') limit?: string,
  ) {
    const cacheKey = this.cacheService.generateKey('dashboard:creative-performance', {
      startDate,
      endDate,
      accountId,
      limit,
    });

    const cached = this.cacheService.get(cacheKey);
    if (cached) return cached;

    const result = await this.performanceService.getCreativePerformance(
      startDate,
      endDate,
      accountId,
      limit ? parseInt(limit) : 10,
    );

    this.cacheService.set(cacheKey, result);
    return result;
  }

  @Get('funnel-snapshot')
  async getFunnelSnapshot(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('accountId') accountId?: string,
  ) {
    const cacheKey = this.cacheService.generateKey('dashboard:funnel-snapshot', {
      startDate,
      endDate,
      accountId,
    });

    const cached = this.cacheService.get(cacheKey);
    if (cached) return cached;

    const result = await this.performanceService.getFunnelSnapshot(
      startDate,
      endDate,
      accountId,
    );

    this.cacheService.set(cacheKey, result);
    return result;
  }
}
