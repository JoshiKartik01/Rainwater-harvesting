#include "water.h"
#include <math.h>

/*
 * Smart Rainwater Harvesting - calculation engine.
 * Units:
 *   rainfall: mm
 *   roof area: m^2
 *   water volumes: litres
 *   coefficients: 0.0 to 1.0
 *
 * A return value of -1.0 indicates invalid input.
 */

static int valid_nonnegative(double x) {
    return isfinite(x) && x >= 0.0;
}

static int valid_coefficient(double x) {
    return isfinite(x) && x >= 0.0 && x <= 1.0;
}

double calculate_potential_runoff(double rainfall_mm,
                                  double roof_area_m2,
                                  double runoff_coefficient) {
    if (!valid_nonnegative(rainfall_mm) ||
        !valid_nonnegative(roof_area_m2) ||
        !valid_coefficient(runoff_coefficient)) {
        return -1.0;
    }

    /* 1 mm rainfall over 1 m^2 = 1 litre. */
    return rainfall_mm * roof_area_m2 * runoff_coefficient;
}

double calculate_usable_inflow(double potential_litres,
                               double collection_efficiency) {
    if (!valid_nonnegative(potential_litres) ||
        !valid_coefficient(collection_efficiency)) {
        return -1.0;
    }

    return potential_litres * collection_efficiency;
}

double calculate_overflow(double storage_litres,
                          double inflow_litres,
                          double tank_capacity_litres) {
    if (!valid_nonnegative(storage_litres) ||
        !valid_nonnegative(inflow_litres) ||
        !isfinite(tank_capacity_litres) ||
        tank_capacity_litres <= 0.0 ||
        storage_litres > tank_capacity_litres) {
        return -1.0;
    }

    double excess = storage_litres + inflow_litres - tank_capacity_litres;
    return excess > 0.0 ? excess : 0.0;
}

double calculate_water_used(double available_litres, double demand_litres) {
    if (!valid_nonnegative(available_litres) ||
        !valid_nonnegative(demand_litres)) {
        return -1.0;
    }

    return available_litres < demand_litres
        ? available_litres
        : demand_litres;
}

double calculate_next_storage(double storage_litres,
                              double inflow_litres,
                              double demand_litres,
                              double tank_capacity_litres) {
    if (!valid_nonnegative(storage_litres) ||
        !valid_nonnegative(inflow_litres) ||
        !valid_nonnegative(demand_litres) ||
        !isfinite(tank_capacity_litres) ||
        tank_capacity_litres <= 0.0 ||
        storage_litres > tank_capacity_litres) {
        return -1.0;
    }

    double available = storage_litres + inflow_litres;
    double retained = available < tank_capacity_litres
        ? available
        : tank_capacity_litres;
    double used = calculate_water_used(retained, demand_litres);

    if (used < 0.0) return -1.0;
    return retained - used;
}

double calculate_unmet_demand(double available_litres, double demand_litres) {
    if (!valid_nonnegative(available_litres) ||
        !valid_nonnegative(demand_litres)) {
        return -1.0;
    }

    return demand_litres > available_litres
        ? demand_litres - available_litres
        : 0.0;
}
