#ifndef SOURCE_TELEMETRY_H
#define SOURCE_TELEMETRY_H

typedef unsigned char sample_bytes[8];
typedef int (*sample_decoder_t)(const sample_bytes raw);
typedef struct __attribute__((packed)) telemetry {
    union {
        struct {
            unsigned channel : 3;
            unsigned ready : 1;
        } flags;
        unsigned status;
    };
    sample_bytes raw;
    void (*notify)(unsigned code, void *user);
} telemetry_t, *telemetry_ptr;

#endif
