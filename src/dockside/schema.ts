import { z } from "zod";

const routerSchema = z
  .object({
    name: z.string(),
    type: z.string().optional(),
    prefixes: z.array(z.string()).optional(),
    auth: z.array(z.string()).optional(),
    http: z.object({ protocol: z.string(), port: z.number() }).optional(),
    https: z.object({ protocol: z.string(), port: z.number() }).optional(),
  })
  .passthrough();

export const docksideReservationSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.number().int(),
    profile: z.string().default(""),
    containerId: z.string().optional(),
    createStatus: z.coerce.number().int().optional(),
    data: z
      .object({
        FQDN: z.string().optional(),
        parentFQDN: z.string().optional(),
        homeDir: z.string().optional(),
        image: z.string().default(""),
        runtime: z.string().optional(),
        network: z.string().default(""),
        unixuser: z.string().optional(),
        runningIDE: z.string().optional(),
      })
      .passthrough()
      .default({ image: "", network: "" }),
    meta: z
      .object({
        access: z.record(z.string(), z.string()).optional(),
        IDE: z.string().optional(),
      })
      .passthrough()
      .default({}),
    profileObject: z
      .object({ routers: z.array(routerSchema).default([]) })
      .passthrough()
      .default({ routers: [] }),
    docker: z
      .object({
        ID: z.string().optional(),
        Image: z.string().optional(),
        ImageId: z.string().optional(),
        Status: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const docksideReservationListSchema = z.array(docksideReservationSchema);

export const docksideUrlCheckSchema = z
  .object({
    status: z.number().int(),
    url: z.string().optional(),
  })
  .passthrough();

export type DocksideReservation = z.infer<typeof docksideReservationSchema>;
