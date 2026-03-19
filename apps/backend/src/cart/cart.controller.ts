import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Param,
  Body,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { CartService } from './cart.service';
import type { Cart } from './cart.types';

// ─── Request body DTO ─────────────────────────────────────────────────────────

interface AddItemBody {
  name: string;
  quantity?: number;
  productRetailerId?: string;
  unitPrice?: number;
  currency?: string;
}

// ─── Controller ───────────────────────────────────────────────────────────────

/**
 * REST endpoints for manual cart management from the dashboard.
 * All mutations also happen automatically via the webhook (inbound messages),
 * so these routes are primarily used by the CartPanel and for testing.
 *
 * Base path: /cart
 */
@Controller('cart')
export class CartController {
  private readonly logger = new Logger(CartController.name);

  constructor(private readonly cartService: CartService) {}

  /**
   * GET /cart?businessId=X&contactWaId=Y
   * Returns the active cart for a contact, or null if none exists.
   */
  @Get()
  async getActiveCart(
    @Query('businessId') businessId: string,
    @Query('contactWaId') contactWaId: string,
  ): Promise<Cart | null> {
    if (!businessId || !contactWaId) {
      throw new BadRequestException('businessId and contactWaId are required');
    }
    this.logger.log(`[CART_GET] businessId=${businessId} contactWaId=${contactWaId}`);
    return this.cartService.getActiveCart(businessId, contactWaId);
  }

  /**
   * POST /cart/items?businessId=X&contactWaId=Y
   * Adds an item to the active cart (creates cart if none exists).
   */
  @Post('items')
  async addItem(
    @Query('businessId') businessId: string,
    @Query('contactWaId') contactWaId: string,
    @Body() body: AddItemBody,
  ): Promise<Cart> {
    if (!businessId || !contactWaId) {
      throw new BadRequestException('businessId and contactWaId are required');
    }
    if (!body.name?.trim()) {
      throw new BadRequestException('name is required');
    }
    this.logger.log(
      `[CART_ADD_ITEM] businessId=${businessId} contactWaId=${contactWaId} name="${body.name}"`,
    );
    return this.cartService.addItem(
      businessId,
      contactWaId,
      body.name.trim(),
      body.quantity ?? 1,
      body.productRetailerId,
      body.unitPrice,
      body.currency,
    );
  }

  /**
   * DELETE /cart/items/:productRetailerId?businessId=X&contactWaId=Y
   * Removes items whose name contains productRetailerId (partial match).
   */
  @Delete('items/:productRetailerId')
  async removeItem(
    @Query('businessId') businessId: string,
    @Query('contactWaId') contactWaId: string,
    @Param('productRetailerId') productRetailerId: string,
  ): Promise<{ success: boolean; cart: Cart }> {
    if (!businessId || !contactWaId) {
      throw new BadRequestException('businessId and contactWaId are required');
    }
    this.logger.log(
      `[CART_REMOVE_ITEM] businessId=${businessId} contactWaId=${contactWaId} retailerId=${productRetailerId}`,
    );
    const { cart, found } = await this.cartService.removeItemByName(
      businessId,
      contactWaId,
      productRetailerId,
    );
    return { success: found, cart };
  }

  /**
   * POST /cart/archive?businessId=X&contactWaId=Y
   * Soft-deletes the active cart by setting status='archived' and creates a
   * fresh empty active cart for future interactions.
   */
  @Post('archive')
  async archiveCart(
    @Query('businessId') businessId: string,
    @Query('contactWaId') contactWaId: string,
  ): Promise<Cart> {
    if (!businessId || !contactWaId) {
      throw new BadRequestException('businessId and contactWaId are required');
    }
    this.logger.log(
      `[CART_ARCHIVE] businessId=${businessId} contactWaId=${contactWaId}`,
    );
    return this.cartService.archiveActiveCart(businessId, contactWaId);
  }
}
