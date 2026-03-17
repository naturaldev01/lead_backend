import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { CohortService } from './cohort.service';
import { SpendRevenueService } from './spend-revenue.service';
import { PerformanceService } from './performance.service';

@Module({
  controllers: [DashboardController],
  providers: [
    DashboardService,
    CohortService,
    SpendRevenueService,
    PerformanceService,
  ],
})
export class DashboardModule {}
