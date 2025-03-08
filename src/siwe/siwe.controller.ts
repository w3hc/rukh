import {
  Controller,
  Get,
  Post,
  Body,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SiweService } from './siwe.service';
import { SiweVerifyDto } from './dto/siwe-verify.dto';
import * as ethers from 'ethers';

@ApiTags('SIWE')
@Controller('siwe')
export class SiweController {
  private readonly logger = new Logger(SiweController.name);

  constructor(private readonly siweService: SiweService) {}

  @Get('nonce')
  @ApiOperation({ summary: 'Get a nonce for SIWE' })
  @ApiResponse({
    status: 200,
    description: 'Returns a nonce',
    schema: {
      properties: {
        nonce: {
          type: 'string',
          description: 'Unique nonce to use in verification',
        },
      },
    },
  })
  getNonce() {
    const nonce = this.siweService.generateNonce();
    this.logger.log(`Generated nonce: ${nonce}`);
    return { nonce };
  }

  @Post('verify')
  @ApiOperation({ summary: 'Verify an address based on its signature' })
  @ApiResponse({
    status: 200,
    description: 'Returns verification result',
    schema: {
      properties: {
        success: {
          type: 'boolean',
          description: 'Whether verification was successful',
        },
        address: {
          type: 'string',
          description: 'The verified Ethereum address',
        },
      },
    },
  })
  async verifySignature(@Body() verifyDto: SiweVerifyDto) {
    const { address, signature } = verifyDto;

    if (!address || !signature) {
      throw new HttpException(
        'Address and signature are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const isValid = this.siweService.verifySignature(address, signature);

      if (isValid) {
        this.logger.log(
          `Signature verification successful for address: ${address}`,
        );

        return {
          success: true,
          address: ethers.getAddress(address), // Return checksummed address
        };
      } else {
        this.logger.warn(
          `Signature verification failed for address: ${address}`,
        );
        throw new HttpException('Invalid signature', HttpStatus.UNAUTHORIZED);
      }
    } catch (error) {
      this.logger.error(`Error verifying signature: ${error.message}`);
      throw new HttpException('Invalid signature', HttpStatus.UNAUTHORIZED);
    }
  }
}
