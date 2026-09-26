import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Ctx, RequirePermissions } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/auth/auth.types';
import { UsersService } from './users.service';
import { CreateUserDto, ListUsersQuery, SetActiveDto, SetOverridesDto, UpdateUserDto } from './users.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** Lista resumida de profissionais — usada por agenda e cadastros (qualquer usuário autenticado). */
  @Get('professionals')
  async professionals(@Ctx() ctx: RequestContext) {
    const all = await this.users.list(ctx, { status: 'active' });
    return all
      .filter((u) => u.professional)
      .map((u) => ({ id: u.id, name: u.name, calendarColor: u.professional!.calendarColor }));
  }

  @RequirePermissions('users.manage')
  @Get()
  list(@Ctx() ctx: RequestContext, @Query() q: ListUsersQuery) {
    return this.users.list(ctx, q);
  }

  @RequirePermissions('users.manage')
  @Get(':id')
  get(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(ctx, id);
  }

  @RequirePermissions('users.manage')
  @Post()
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateUserDto) {
    return this.users.create(ctx, dto);
  }

  @RequirePermissions('users.manage')
  @Patch(':id')
  update(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(ctx, id, dto);
  }

  @RequirePermissions('users.manage')
  @Put(':id/active')
  setActive(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetActiveDto) {
    return this.users.setActive(ctx, id, dto.isActive);
  }

  @RequirePermissions('users.manage')
  @Post(':id/unlock')
  unlock(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.unlock(ctx, id);
  }

  @RequirePermissions('users.manage', 'roles.manage')
  @Put(':id/permissions')
  setOverrides(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetOverridesDto) {
    return this.users.setOverrides(ctx, id, dto);
  }

  @RequirePermissions('users.manage')
  @Post(':id/send-access-link')
  sendAccessLink(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.sendAccessLink(ctx, id);
  }
}
