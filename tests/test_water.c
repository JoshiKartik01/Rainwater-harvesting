#include <assert.h>
#include <math.h>
#include <stdio.h>
#include "../src/water.h"

static int close_to(double a, double b) {
    return fabs(a - b) < 0.001;
}

int main(void) {
    assert(close_to(calculate_potential_runoff(10, 1000, 0.8), 8000));
    assert(close_to(calculate_usable_inflow(8000, 0.9), 7200));
    assert(close_to(calculate_overflow(9000, 3000, 10000), 2000));
    assert(close_to(calculate_water_used(4000, 6000), 4000));
    assert(close_to(calculate_next_storage(5000, 3000, 4000, 10000), 4000));
    assert(close_to(calculate_unmet_demand(4000, 6000), 2000));
    assert(calculate_potential_runoff(-1, 100, 0.8) < 0);
    assert(calculate_potential_runoff(10, 100, 1.5) < 0);

    puts("All water-engine tests passed.");
    return 0;
}
