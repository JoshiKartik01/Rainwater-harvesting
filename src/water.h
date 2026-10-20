#ifndef WATER_H
#define WATER_H

#ifdef __cplusplus
extern "C" {
#endif

double calculate_potential_runoff(double rainfall_mm,
                                  double roof_area_m2,
                                  double runoff_coefficient);

double calculate_usable_inflow(double potential_litres,
                               double collection_efficiency);

double calculate_overflow(double storage_litres,
                          double inflow_litres,
                          double tank_capacity_litres);

double calculate_water_used(double available_litres,
                            double demand_litres);

double calculate_next_storage(double storage_litres,
                              double inflow_litres,
                              double demand_litres,
                              double tank_capacity_litres);

double calculate_unmet_demand(double available_litres,
                              double demand_litres);

#ifdef __cplusplus
}
#endif

#endif
