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

  @Get('challenge')
  @ApiOperation({ summary: 'Get a challenge message for SIWE authentication' })
  @ApiResponse({
    status: 200,
    description: 'Returns a message to sign and a nonce',
    schema: {
      properties: {
        message: {
          type: 'string',
          description: 'Message that should be signed by the client',
        },
        nonce: {
          type: 'string',
          description: 'Unique nonce to use in verification',
        },
      },
    },
  })
  getChallenge() {
    const { message, nonce } = this.siweService.generateMessage();
    this.logger.log(`Generated challenge with nonce: ${nonce}`);
    return { message, nonce };
  }

  @Post('verify')
  @ApiOperation({
    summary: 'Verify a signed message from client (Etherscan, Zhankai, ...)',
  })
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
    const { address, signature, nonce } = verifyDto;

    if (!address || !signature || !nonce) {
      throw new HttpException(
        'Address, signature, and nonce are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const isValid = this.siweService.verifySignature(
        address,
        signature,
        nonce,
      );

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
