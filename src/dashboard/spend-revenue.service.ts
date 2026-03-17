import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';

export interface SpendVsRevenueData {
  month: string;
  spend: number;
  leads: number;
  revenue: number;
}

export interface RevenueByDealDateData {
  month: string;
  revenue: number;
  dealCount: number;
}

@Injectable()
export class SpendRevenueService {
  private readonly logger = new Logger(SpendRevenueService.name);

  constructor(private supabaseService: SupabaseService) {}

  async getSpendVsRevenue(
    startDate?: string,
    endDate?: string,
    accountId?: string,
  ): Promise<SpendVsRevenueData[]> {
    const supabase = this.supabaseService.getClient();

    try {
      const { data, error } = await supabase.rpc('get_spend_vs_revenue_optimized', {
        p_start_date: startDate || null,
        p_end_date: endDate || null,
        p_account_id: accountId || null,
      });

      if (error) {
        this.logger.error('RPC get_spend_vs_revenue_optimized failed', error);
        return [];
      }

      return (data || []).map((row: any) => ({
        month: row.month,
        spend: parseFloat(row.spend) || 0,
        leads: parseInt(row.leads) || 0,
        revenue: parseFloat(row.revenue) || 0,
      }));
    } catch (err) {
      this.logger.error('Failed to fetch spend vs revenue', err);
      return [];
    }
  }

  async getRevenueByDealDate(
    startDate?: string,
    endDate?: string,
    accountId?: string,
  ): Promise<RevenueByDealDateData[]> {
    const supabase = this.supabaseService.getClient();

    try {
      const { data, error } = await supabase.rpc('get_revenue_by_deal_date_optimized', {
        p_start_date: startDate || null,
        p_end_date: endDate || null,
        p_account_id: accountId || null,
      });

      if (error) {
        this.logger.error('RPC get_revenue_by_deal_date_optimized failed', error);
        return [];
      }

      return (data || []).map((row: any) => ({
        month: row.month,
        revenue: parseFloat(row.revenue) || 0,
        dealCount: parseInt(row.deal_count) || 0,
      }));
    } catch (err) {
      this.logger.error('Failed to fetch revenue by deal date', err);
      return [];
    }
  }
}
