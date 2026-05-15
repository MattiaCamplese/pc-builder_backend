import { integer, numeric, pgEnum, pgTable, primaryKey, serial, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum ("role", ["admin", "user"]);

export const user = pgTable('users', {
    id: uuid().primaryKey().defaultRandom(),
    email: text().unique().notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    password: text().notNull(),
    emailVerificationCode: text("email_verification_code"),
    emailVerifiedAt: timestamp("email_verified_at"),
    emailCodeAt: timestamp("email_code_at"),
    passwordRecoveryCode: text("password_recovery_code"),
    passwordRecoveryAt: timestamp("password_recovery_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    role: userRoleEnum("role").notNull().default("user"),
})
export const cpus = pgTable('cpus', {
  id:          serial().primaryKey(),
  name:        text().notNull(),
  brand:       text().notNull(),
  socket:      text().notNull(),
  speedGhz:    numeric('speed_ghz', { precision: 4, scale: 1 }),
  coreCount:   smallint('core_count'),
  threadCount: smallint('thread_count'),
  tdpW:        smallint('tdp_w'),
  ramType:     text('ram_type'),
  priceEur:    numeric('price_eur', { precision: 8, scale: 2 }),
  imageUrl:    text('image_url'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
})

export const motherboards = pgTable('motherboards', {
  id:          serial().primaryKey(),
  name:        text().notNull(),
  brand:       text().notNull(),
  socket:      text().notNull(),
  chipset:     text(),
  formFactor:  text('form_factor').notNull(),
  ramType:     text('ram_type'),
  ramSlots:    smallint('ram_slots'),
  maxRamGb:    smallint('max_ram_gb'),
  m2Slots:     smallint('m2_slots'),
  sataPorts:   smallint('sata_ports'),
  pcieVersion: smallint('pcie_version'),
  priceEur:    numeric('price_eur', { precision: 8, scale: 2 }),
  imageUrl:    text('image_url'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
})

export const gpus = pgTable('gpus', {
  id:          serial().primaryKey(),
  name:        text().notNull(),
  brand:       text().notNull(),
  chipset:     text(),
  vramGb:      smallint('vram_gb'),
  resolution:  text(),
  tdpW:        smallint('tdp_w'),
  lengthMm:    smallint('length_mm'),
  pcieVersion: smallint('pcie_version'),
  priceEur:    numeric('price_eur', { precision: 8, scale: 2 }),
  imageUrl:    text('image_url'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
})

export const memory = pgTable('memory', {
  id:         serial().primaryKey(),
  name:       text().notNull(),
  type:       text().notNull(),
  capacityGb: smallint('capacity_gb').notNull(),
  speedMhz:   smallint('speed_mhz'),
  sticks:     smallint(),
  cl:         smallint(),
  priceEur:   numeric('price_eur', { precision: 8, scale: 2 }),
  imageUrl:   text('image_url'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
})

export const cases = pgTable('cases', {
  id:                 serial().primaryKey(),
  name:               text().notNull(),
  formFactor:         text('form_factor').notNull(),
  psuFormFactor:      text('psu_form_factor'),
  maxGpuLengthMm:     smallint('max_gpu_length_mm'),
  maxCoolerHeightMm:  smallint('max_cooler_height_mm'),
  radiatorSupport:    text('radiator_support'),
  priceEur:           numeric('price_eur', { precision: 8, scale: 2 }),
  imageUrl:           text('image_url'),
  createdAt:          timestamp('created_at').notNull().defaultNow(),
})

export const psus = pgTable('psus', {
  id:          serial().primaryKey(),
  name:        text().notNull(),
  wattageW:    smallint('wattage_w').notNull(),
  formFactor:  text('form_factor').notNull(),
  efficiency:  text(),
  modular:     text(),
  priceEur:    numeric('price_eur', { precision: 8, scale: 2 }),
  imageUrl:    text('image_url'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
})

export const coolers = pgTable('coolers', {
  id:            serial().primaryKey(),
  name:          text().notNull(),
  type:          text().notNull(),
  radiatorMm:    smallint('radiator_mm'),
  socketSupport: text('socket_support'),
  maxTdpW:       smallint('max_tdp_w'),
  priceEur:      numeric('price_eur', { precision: 8, scale: 2 }),
  imageUrl:      text('image_url'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
})

export const storage = pgTable('storage', {
  id:         serial().primaryKey(),
  name:       text().notNull(),
  type:       text().notNull(),
  formFactor: text('form_factor').notNull(),
  capacityGb: smallint('capacity_gb').notNull(),
  pcieGen:    smallint('pcie_gen'),
  priceEur:   numeric('price_eur', { precision: 8, scale: 2 }),
  imageUrl:   text('image_url'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
})

export const build = pgTable('builds', {
  id:            serial().primaryKey(),
  userId:        uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name:          text().notNull().default('La mia build'),
  cpuId:         integer('cpu_id').references(() => cpus.id),
  motherboardId: integer('motherboard_id').references(() => motherboards.id),
  gpuId:         integer('gpu_id').references(() => gpus.id),
  ramId:         integer('ram_id').references(() => memory.id),
  caseId:        integer('case_id').references(() => cases.id),
  psuId:         integer('psu_id').references(() => psus.id),
  coolerId:      integer('cooler_id').references(() => coolers.id),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
})

export const buildStorage = pgTable('build_storage', {
  buildId:   integer('build_id').notNull().references(() => build.id, { onDelete: 'cascade' }),
  storageId: integer('storage_id').notNull().references(() => storage.id),
}, (t) => [primaryKey({ columns: [t.buildId, t.storageId] })])