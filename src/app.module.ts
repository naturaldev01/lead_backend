import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from './common/common.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { LeadsModule } from './leads/leads.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { MappingsModule } from './mappings/mappings.module';
import { AdAccountsModule } from './ad-accounts/ad-accounts.module';
import { MetaModule } from './meta/meta.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    CommonModule,
    DashboardModule,
    CampaignsModule,
    LeadsModule,
    SubscriptionsModule,
    MappingsModule,
    AdAccountsModule,
    MetaModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
