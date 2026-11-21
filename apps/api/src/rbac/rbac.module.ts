import { Global, Module } from '@nestjs/common';
import { ActorService } from './actor.service';
import { PermissionsGuard } from './permissions.guard';

@Global()
@Module({
  providers: [ActorService, PermissionsGuard],
  exports: [ActorService, PermissionsGuard],
})
export class RbacModule {}
