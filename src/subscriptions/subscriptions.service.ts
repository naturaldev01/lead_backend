import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { MetaService } from '../meta/meta.service';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private supabaseService: SupabaseService,
    private metaService: MetaService,
  ) {}

  async getSubscriptions() {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from('subscriptions')
      .select(`
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

  async refreshSubscriptions() {
    const supabase = this.supabaseService.getClient();

    try {
      const { data: accounts } = await supabase
        .from('ad_accounts')
        .select('*');

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

      for (const account of accounts || []) {
        try {
          const status = await this.metaService.getSubscriptionStatus(account.account_id);
          const isSubscribed = status.length > 0;

          const { data: sub } = await supabase
            .from('subscriptions')
            .upsert({
              ad_account_id: account.id,
              status: isSubscribed ? 'subscribed' : 'not_subscribed',
              fields: isSubscribed ? 'leadgen,ads,adsets,campaigns' : '',
              last_attempt: new Date().toISOString(),
              last_success: isSubscribed ? new Date().toISOString() : null,
            }, { onConflict: 'ad_account_id' })
            .select()
            .single();

          if (sub) {
            subscriptions.push({
              id: sub.id,
              accountName: account.account_name,
              accountId: account.account_id,
              status: sub.status,
              fields: sub.fields,
              lastAttempt: sub.last_attempt,
              lastSuccess: sub.last_success,
              lastError: sub.last_error,
            });
          }
        } catch (error) {
          this.logger.error(`Failed to check subscription for ${account.account_id}`, error);

          await supabase
            .from('subscriptions')
            .upsert({
              ad_account_id: account.id,
              status: 'error',
              last_attempt: new Date().toISOString(),
              last_error: (error as Error).message,
            }, { onConflict: 'ad_account_id' });
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
      const { data: accounts } = await supabase
        .from('ad_accounts')
        .select('*');

      for (const account of accounts || []) {
        try {
          await this.metaService.subscribeToWebhook(account.account_id);

          await supabase
            .from('subscriptions')
            .upsert({
              ad_account_id: account.id,
              status: 'subscribed',
              fields: 'leadgen,ads,adsets,campaigns',
              last_attempt: new Date().toISOString(),
              last_success: new Date().toISOString(),
            }, { onConflict: 'ad_account_id' });
        } catch (error) {
          this.logger.error(`Failed to subscribe ${account.account_id}`, error);

          await supabase
            .from('subscriptions')
            .upsert({
              ad_account_id: account.id,
              status: 'error',
              last_attempt: new Date().toISOString(),
              last_error: (error as Error).message,
            }, { onConflict: 'ad_account_id' });
        }
      }

      return { success: true };
    } catch (error) {
      this.logger.error('Failed to auto-subscribe', error);
      throw error;
    }
  }
}
