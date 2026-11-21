import { Global, Module } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { NotificationsService } from './notifications.service';
import { QueueService } from './queue.service';
import { WHATSAPP_ADAPTER, createWhatsAppAdapter } from './whatsapp.adapter';

@Global()
@Module({
  providers: [
    QueueService,
    NotificationsService,
    { provide: WHATSAPP_ADAPTER, inject: [ENV], useFactory: (env: Env) => createWhatsAppAdapter(env) },
  ],
  exports: [QueueService, NotificationsService, WHATSAPP_ADAPTER],
})
export class NotificationsModule {}
