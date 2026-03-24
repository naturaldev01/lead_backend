import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { MetaService } from '../meta/meta.service';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);
  private readonly CONCURRENCY_LIMIT = 5;

  constructor(
    private supabaseService: SupabaseService,
    private metaService: MetaService,
  ) {}

  async getSubscriptions() {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase.from('subscriptions').select(`
        *,
        ad_accounts (account_name, account_id)
      `);

    if (error) {
      this.logger.error('Failed to fetch subscriptions', error);
      throw error;
    }

    return (data || []).map((sub) => ({
      id: sub.id,
      accountName: sub.ad_accounts?.account_name || '',
      accountId: sub.ad_accounts?.account_id || '',
      status: sub.status,
      fields: sub.fields,
      lastAttempt: sub.last_attempt,
      lastSuccess: sub.last_success,
      lastError: sub.last_error,
    }));
  }

  private async runWithConcurrencyLimit<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
  ): Promise<PromiseSettledResult<R>[]> {
    const results: PromiseSettledResult<R>[] = [];

    for (let i = 0; i < items.length; i += limit) {
      const batch = items.slice(i, i + limit);
      const batchResults = await Promise.allSettled(batch.map(fn));
      results.push(...batchResults);
    }

    return results;
  }

  async refreshSubscriptions() {
    const supabase = this.supabaseService.getClient();

    try {
      const { data: accounts } = await supabase.from('ad_accounts').select('*');

      if (!accounts || accounts.length === 0) {
        return [];
      }

      const subscriptions: Array<{
        id: string;
        accountName: string;
        accountId: string;
        status: string;
        fields: string;
        lastAttempt: string;
        lastSuccess: string | null;
        lastError: string | null;
      }> = [];

      const processAccount = async (account: any) => {
        try {
          const status = await this.metaService.getSubscriptionStatus(
            account.account_id,
          );
          const isSubscribed = status.length > 0;

          const { data: sub } = await supabase
            .from('subscriptions')
            .upsert(
              {
                ad_account_id: account.id,
                status: isSubscribed ? 'subscribed' : 'not_subscribed',
                fields: isSubscribed ? 'leadgen,ads,adsets,campaigns' : '',
                last_attempt: new Date().toISOString(),
                last_success: isSubscribed ? new Date().toISOString() : null,
              },
              { onConflict: 'ad_account_id' },
            )
            .select()
            .single();

          if (sub) {
            return {
              id: sub.id,
              accountName: account.account_name,
              accountId: account.account_id,
              status: sub.status,
              fields: sub.fields,
              lastAttempt: sub.last_attempt,
              lastSuccess: sub.last_success,
              lastError: sub.last_error,
            };
          }
          return null;
        } catch (error) {
          this.logger.error(
            `Failed to check subscription for ${account.account_id}`,
            error,
          );

          await supabase.from('subscriptions').upsert(
            {
              ad_account_id: account.id,
              status: 'error',
              last_attempt: new Date().toISOString(),
              last_error: (error as Error).message,
            },
            { onConflict: 'ad_account_id' },
          );

          return null;
        }
      };

      const results = await this.runWithConcurrencyLimit(
        accounts,
        this.CONCURRENCY_LIMIT,
        processAccount,
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          subscriptions.push(result.value);
        }
      }

      return subscriptions;
    } catch (error) {
      this.logger.error('Failed to refresh subscriptions', error);
      throw error;
    }
  }

  async autoSubscribe() {
    const supabase = this.supabaseService.getClient();

    try {
      const { data: accounts } = await supabase.from('ad_accounts').select('*');

      if (!accounts || accounts.length === 0) {
        return { success: true };
      }

      const processAccount = async (account: any) => {
        try {
          await this.metaService.subscribeToWebhook(account.account_id);

          await supabase.from('subscriptions').upsert(
            {
              ad_account_id: account.id,
              status: 'subscribed',
              fields: 'leadgen,ads,adsets,campaigns',
              last_attempt: new Date().toISOString(),
              last_success: new Date().toISOString(),
            },
            { onConflict: 'ad_account_id' },
          );

          return { success: true, accountId: account.account_id };
        } catch (error) {
          this.logger.error(`Failed to subscribe ${account.account_id}`, error);

          await supabase.from('subscriptions').upsert(
            {
              ad_account_id: account.id,
              status: 'error',
              last_attempt: new Date().toISOString(),
              last_error: (error as Error).message,
            },
            { onConflict: 'ad_account_id' },
          );

          return { success: false, accountId: account.account_id, error: (error as Error).message };
        }
      };

      await this.runWithConcurrencyLimit(
        accounts,
        this.CONCURRENCY_LIMIT,
        processAccount,
      );

      return { success: true };
    } catch (error) {
      this.logger.error('Failed to auto-subscribe', error);
      throw error;
    }
  }
}
