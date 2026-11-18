# Tractor Sequencer

I built Tractor Sequencer for my Agricultural Machinery II course (TAE 521) to answer a question a farmers’ cooperative faces when its members share one tractor: **whose field should be ploughed first?**

Booking order is easy to explain, but it tells the booking officer little about the cost of making a farmer wait. If two fields are ready and planting depends on ploughing, a day’s delay can matter more on one field than on the other. I wanted to see how much difference the cooperative could make by changing the service order while keeping the tractor, the farms and the total work the same.

## How the schedule works

For each booking, I estimate two quantities:

- **Crop value lost per day of delay (₦/day):** field area × expected yield per hectare × crop price per tonne × daily loss fraction. A fraction of 0.01 represents 1% of the field’s potential crop value per day.
- **Tractor time (hours):** field area ÷ effective field capacity, plus an allowance for travel and setup.

I divide daily loss by tractor time and rank the farms from highest to lowest. This applies [Smith’s rule](https://doi.org/10.1002/nav.3800030106) to a single tractor. To compare two schedules, I multiply each farm’s daily loss by the number of working days until its job finishes, then add those losses across all farms.

In the four-farm example, the maize field stands to lose more per day than the rice field. But ploughing the maize first makes the rice farmer wait 2.35 hours, at an estimated cost of ₦2,570. Ploughing the rice first makes the maize farmer wait only 1.225 hours, at an estimated cost of ₦1,929. For those two bookings, rice first reduces the estimated loss by about ₦641.

## What the simulation showed

I compared three schedules for 28 synthetic farms covering 48.46 hectares. Every schedule required 77.38 tractor hours.

| Service order | Estimated total loss | Reduction from booking order | Largest extra delay for one farm |
| --- | ---: | ---: | ---: |
| Booking order | ₦2,254,585 | — | 0 days |
| Priority order | ₦1,550,736 | 31.2% | 7.37 days |
| Priority with a three-day extra-delay limit | ₦1,668,545 | 26.0% | 2.98 days |

The trade-off is clearest in the last column. Priority order gives the lowest overall loss, but one member finishes more than seven working days later than they would have under booking order. The delay limit lets the cooperative protect that member while still reducing the group’s estimated loss. It limits **additional** delay relative to the original booking, not total waiting time.

## Implementation

I used HTML, CSS and vanilla JavaScript so a booking officer can use the planner offline without an account or server. The scheduling calculations are in `model.js`; `app.js` handles bookings, settings and results. The interface explains individual decisions by showing what would change if two farms swapped places. Bookings can be saved locally, and the results can be exported as CSV.

## Scope and limitations

The prototype covers one tractor ploughing fields that are all ready at the start. I assume that planting follows ploughing, delay losses increase linearly, and travel and setup take a fixed time per farm. The model does not account for routes, breakdowns, weather or switching implements.

The default maize, rice and soybean loss fractions are historical US seeding examples from [ASAE D497.5, Table 6](https://faculty.uobasrah.edu.iq/uploads/teaching/1722757166.pdf). The cowpea fraction, yields and prices are illustrative. The results show what changing the order can do under those assumptions; they are not measured savings on Nigerian farms. My next step would be to test the schedule against a cooperative’s booking records, actual job durations and locally supported crop-loss estimates.
