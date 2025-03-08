import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsEthereumAddress } from 'class-validator';

export class SiweVerifyDto {
  @ApiProperty({
    description: 'Ethereum address to verify',
    example: '0xa2D5de1637a6d1E25209B74d91Aa71BA2EF4a261',
  })
  @IsEthereumAddress()
  @IsNotEmpty()
  address: string;

  @ApiProperty({
    description: 'Signature hash',
    example:
      '0x63147a193217ac67619b1e609add27eb47a7a1bb3381ba9b18513e4aa303d147063ffacf68d0f8c418e5e940de3e392f2a00a7a0a881b87afc58657fbd1ed4511b',
  })
  @IsString()
  @IsNotEmpty()
  signature: string;

  @ApiProperty({
    description: 'Nonce from the challenge',
    example: 'f0ea9dc7-03e8-46a7-b3ad-6c3531211f73',
  })
  @IsString()
  @IsNotEmpty()
  nonce: string;
}
