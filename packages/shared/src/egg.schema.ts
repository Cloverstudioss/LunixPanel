import { z } from 'zod';

export const EggVariableSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  env_variable: z.string().min(1),
  default_value: z.string().default(''),
  user_viewable: z.boolean().default(true),
  user_editable: z.boolean().default(true),
  rules: z.string().default('required|string|max:191'),
  sort: z.number().int().default(0),
});

const JsonStringOrObject = z.union([z.string(), z.record(z.any())]);

export const EggConfigSchema = z.object({
  files: JsonStringOrObject.optional(),
  startup: JsonStringOrObject.optional(),
  stop: z.string().optional(),
  logs: JsonStringOrObject.optional(),
  extends: z.string().nullable().optional(),
}).passthrough();

export const EggScriptSchema = z.object({
  privileged: z.boolean().default(false),
  install: z.string().nullable().optional(),
  entry: z.string().default('ash'),
  container: z.string().default('ghcr.io/pterodactyl/installers:alpine'),
  image: z.string().default('ghcr.io/pterodactyl/installers:alpine'),
}).passthrough();

export const PterodactylEggSchema = z.object({
  _comment: z.string().optional(),
  meta: z.object({ version: z.string(), update_url: z.string().nullable().optional() }).passthrough().optional(),
  exported_at: z.string().optional(),
  name: z.string().min(1),
  author: z.string().default('unknown'),
  description: z.string().nullable().optional(),
  features: z.array(z.string()).nullable().optional(),
  docker_images: z.record(z.string()).default({}),
  file_denylist: z.array(z.string()).nullable().optional(),
  startup: z.string().min(1),
  config: EggConfigSchema.default({}),
  scripts: z.object({ installation: EggScriptSchema }).passthrough().optional(),
  script: EggScriptSchema.optional(),
  variables: z.array(EggVariableSchema).default([]),
}).passthrough();

export type PterodactylEgg = z.infer<typeof PterodactylEggSchema>;
