import { cpus, motherboards, gpus, memory, cases, psus, coolers, storage } from '../db/schema.js';

type Cpu = typeof cpus.$inferSelect;
type Motherboard = typeof motherboards.$inferSelect;
type Gpu = typeof gpus.$inferSelect;
type Memory = typeof memory.$inferSelect;
type Case = typeof cases.$inferSelect;
type Psu = typeof psus.$inferSelect;
type Cooler = typeof coolers.$inferSelect;
type Storage = typeof storage.$inferSelect;

export type BuildConfig = {
    cpu?: Cpu;
    motherboard?: Motherboard;
    gpu?: Gpu;
    ram?: Memory;
    case?: Case;
    psu?: Psu;
    cooler?: Cooler;
    storages?: Storage[];
};

export type Constraints = {
    motherboard?: { socket?: string };
    memory?: { type?: string };
    case?: { formFactor?: string };
    gpu?: { lengthMm_lte?: number };
    psu?: { formFactor?: string; wattageW_gte?: number };
    cooler?: { socketSupport?: string; maxTdpW_gte?: number };
};

export function deriveConstraints(config: BuildConfig): Constraints {
    const c: Constraints = {};

    if (config.cpu) {
        c.motherboard = { socket: config.cpu.socket };
        c.cooler = {
            socketSupport: config.cpu.socket,
            maxTdpW_gte: config.cpu.tdpW ?? undefined,
        };
    }

    if (config.motherboard) {
        c.memory = { type: config.motherboard.ramType ?? undefined };
        c.case = { formFactor: config.motherboard.formFactor };
        c.cooler = { ...c.cooler, socketSupport: config.motherboard.socket };
    }

    if (config.case) {
        c.gpu = { lengthMm_lte: config.case.maxGpuLengthMm ?? undefined };
        c.psu = { formFactor: config.case.psuFormFactor ?? undefined };
    }

    if (config.cpu || config.gpu) {
        const cpuTdp = config.cpu?.tdpW ?? 0;
        const gpuTdp = config.gpu?.tdpW ?? 0;
        const minWatt = Math.ceil((cpuTdp + gpuTdp + 90) * 1.25);
        c.psu = { ...c.psu, wattageW_gte: minWatt };
    }

    return c;
}

export type ValidationError = { field: string; message: string };

export function validateBuild(config: BuildConfig): ValidationError[] {
    const errors: ValidationError[] = [];
    const { cpu, motherboard, gpu, ram, case: pcCase, psu, cooler, storages = [] } = config;

    if (cpu && motherboard && cpu.socket !== motherboard.socket)
        errors.push({ field: 'motherboard', message: `Socket incompatibile: CPU ${cpu.socket} ≠ Motherboard ${motherboard.socket}` });

    if (cpu && cooler) {
        if (cooler.maxTdpW && cpu.tdpW && cpu.tdpW > cooler.maxTdpW)
            errors.push({ field: 'cooler', message: `Cooler TDP insufficiente: CPU ${cpu.tdpW}W > Cooler max ${cooler.maxTdpW}W` });
        if (cooler.socketSupport && cpu.socket && !cooler.socketSupport.includes(cpu.socket))
            errors.push({ field: 'cooler', message: `Cooler non supporta socket ${cpu.socket}` });
    }

    if (motherboard && ram && motherboard.ramType && ram.type !== motherboard.ramType)
        errors.push({ field: 'ram', message: `RAM incompatibile: ${ram.type} ≠ ${motherboard.ramType}` });

    if (motherboard && pcCase && motherboard.formFactor !== pcCase.formFactor)
        errors.push({ field: 'case', message: `Form factor incompatibile: Motherboard ${motherboard.formFactor} ≠ Case ${pcCase.formFactor}` });

    if (gpu && pcCase && pcCase.maxGpuLengthMm && gpu.lengthMm && gpu.lengthMm > pcCase.maxGpuLengthMm)
        errors.push({ field: 'gpu', message: `GPU troppo lunga: ${gpu.lengthMm}mm > Case max ${pcCase.maxGpuLengthMm}mm` });

    if (pcCase && psu && pcCase.psuFormFactor && psu.formFactor !== pcCase.psuFormFactor)
        errors.push({ field: 'psu', message: `PSU form factor incompatibile: ${psu.formFactor} ≠ ${pcCase.psuFormFactor}` });

    if (psu && (cpu || gpu)) {
        const cpuTdp = cpu?.tdpW ?? 0;
        const gpuTdp = gpu?.tdpW ?? 0;
        const minWatt = Math.ceil((cpuTdp + gpuTdp + 90) * 1.25);
        if (psu.wattageW < minWatt)
            errors.push({ field: 'psu', message: `PSU insufficiente: ${psu.wattageW}W < minimo richiesto ${minWatt}W` });
    }

    if (motherboard) {
        const nvmeCount = storages.filter(s => s.type === 'NVME').length;
        if (motherboard.m2Slots !== null && nvmeCount > (motherboard.m2Slots ?? 0))
            errors.push({ field: 'storage', message: `Troppi NVMe: ${nvmeCount} > slot M.2 disponibili ${motherboard.m2Slots}` });

        const sataCount = storages.filter(s => s.type === 'SATA' || s.type === 'HDD').length;
        if (motherboard.sataPorts !== null && sataCount > (motherboard.sataPorts ?? 0))
            errors.push({ field: 'storage', message: `Troppi drive SATA/HDD: ${sataCount} > porte disponibili ${motherboard.sataPorts}` });
    }

    return errors;
}
