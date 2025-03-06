import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = (await NestFactory.create(AppModule)) as any;

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Rukh')
    .setDescription(
      'Nest.js-based AI agent starter kit. \n\nGitHub repo: https://github.com/w3hc/rukh',
    )
    .setVersion('0.2.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);

  logger.log(`Rukh API version: 0.1.0-alpha`);
  logger.log(`Environment: ${process.env.NODE_ENV || 'unset'}`);
  logger.log(`Server running on port: ${port}`);
  logger.log(`Swagger docs available at: http://localhost:${port}/api`);
  logger.log(`See the Rukh fly! ❤️`);
}
bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error('Failed to start the application:', error);
  process.exit(1);
});
