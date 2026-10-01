import { ApiProperty } from '@nestjs/swagger';
import { StreamCost } from '../types/llm-stream';

export class RagMetadataDto {
  @ApiProperty({
    description: 'Files selected for this query',
    example: ['rukh-definition.md', 'architecture.md'],
  })
  selectedFiles: string[];

  @ApiProperty({
    description: 'URLs selected for this query',
    example: ['https://example.com/docs'],
    required: false,
  })
  selectedUrls?: string[];

  @ApiProperty({
    description: 'Total files available in the context',
    example: 10,
  })
  totalFilesAvailable: number;

  @ApiProperty({
    description: 'Total URLs available in the context',
    example: 3,
    required: false,
  })
  totalUrlsAvailable?: number;

  @ApiProperty({
    description: 'Selection method used',
    example: 'rag-two-step',
  })
  selectionMethod: string;

  @ApiProperty({
    description: 'Cost of the file selection phase',
    required: false,
  })
  selectionCost?: StreamCost | null;
}
