import { z } from "zod";

// Shapes of the Dockside CLI's JSON. Each schema names only the fields Crucible reads, and `passthrough` tolerates
// the rest so a newer Dockside adding fields does not break us. A missing or mistyped field we rely on still fails
// loudly at the adapter boundary.

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

/** One Dockside reservation, which is what Dockside calls an environment. */
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

/** Result of `dockside check-url`: the HTTP status the URL returned. */
export const docksideUrlCheckSchema = z
  .object({
    status: z.number().int(),
    url: z.string().optional(),
  })
  .passthrough();

export type DocksideReservation = z.infer<typeof docksideReservationSchema>;
