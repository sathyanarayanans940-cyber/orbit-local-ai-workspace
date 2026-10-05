"""Independent reference calculations. Never sent to the tested model."""
import json
import math
from pathlib import Path

x = list(range(10, 27, 2))
y = [99, 95, 90, 85, 80, 75, 70, 65, 60]
n = len(x)
sx, sy = sum(x), sum(y)
sx2, sy2, sxy = sum(v*v for v in x), sum(v*v for v in y), sum(a*b for a,b in zip(x,y))
a, b, c = n*sx2-sx*sx, n*sy2-sy*sy, n*sxy-sx*sy
rank = lambda values: [1+sum(v > item for v in values) for item in values]
re = rank([78,65,82,70,91,68,75,88,60,84])
rs = rank([80,62,85,74,89,70,73,92,65,81])
d2 = sum((p-q)**2 for p,q in zip(re,rs))
sf = lambda z: .5*math.erfc(z/math.sqrt(2))
left = lambda value: sf((2*value-7)/2.5)+sf((2*value+7)/2.5)
right = lambda value: sf((119-value)/math.sqrt(13))-sf((119+value)/math.sqrt(13))
low, high = 0, 100
for _ in range(150):
    middle = (low+high)/2
    if left(middle) > right(middle):
        low = middle
    else:
        high = middle
lam = (low+high)/2
z = (.075-.05)/math.sqrt(.05*.95/400)
result = {
    "q1": {"n":n,"sum_x":sx,"sum_y":sy,"sum_x2":sx2,"sum_y2":sy2,"sum_xy":sxy,"A":a,"B":b,"C":c,
           "r":c/math.sqrt(a*b),"y_slope":c/a,"y_intercept":sy/n-c/a*sx/n,"demand_at_30":sy/n+c/a*(30-sx/n),
           "x_slope":c/b,"x_intercept":sx/n-c/b*sy/n,"price_at_72":sx/n+c/b*(72-sy/n)},
    "q2": {"english_ranks":re,"spanish_ranks":rs,"sum_d2":d2,"spearman":1-6*d2/(10*(10**2-1)),
           "partial":(.75-.60*.50)/math.sqrt((1-.60**2)*(1-.50**2)),
           "multiple":math.sqrt((.75**2+.60**2-2*.75*.60*.50)/(1-.50**2))},
    "q3": {"overbooked":6/32,"at_least_one_empty":16/32},
    "q4": {"absolute_difference":1-sf(2.4)+sf(3.2),"lambda":lam,"left_complement":left(lam),"right_complement":right(lam),"complement_ratio":left(lam)/right(lam)},
    "q5": {"first_wait":math.exp(-6),"third_wait":25*math.exp(-6)},
    "q6": {"z":z,"p_value":sf(z),"reject_at_5_percent":True},
}
output = Path(__file__).resolve().parent / "output/live-statistics/reference.json"
output.parent.mkdir(parents=True,exist_ok=True)
output.write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
