import * as Joi from 'joi';

/**
 * Boot-time environment validation. Wired into `ConfigModule.forRoot` so a missing or
 * malformed variable fails loudly at startup rather than at the first request.
 *
 * Defaulted keys use `.empty('')` so that copying `.env.example` verbatim — where every
 * value is blank — still boots. Required keys deliberately do not, so a blank
 * `MONGODB_URI` is an immediate, readable error.
 */
export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .empty('')
    .default('development'),
  PORT: Joi.number().port().empty('').default(4000),

  MONGODB_URI: Joi.string()
    .uri({ scheme: [/mongodb\+srv/, 'mongodb'] })
    .required(),

  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL: Joi.string().empty('').default('15m'),
  JWT_REFRESH_TTL: Joi.string().empty('').default('7d'),

  CLOUDINARY_CLOUD_NAME: Joi.string().required(),
  CLOUDINARY_API_KEY: Joi.string().required(),
  CLOUDINARY_API_SECRET: Joi.string().required(),

  FRONTEND_URL: Joi.string().uri().empty('').default('http://localhost:3000'),
});
