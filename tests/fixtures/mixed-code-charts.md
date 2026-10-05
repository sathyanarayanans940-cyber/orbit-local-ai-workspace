### 1. Line Plot 📈
This plot shows the age of each employee. Since `type="l"` is used, it connects the ages with a line.

**The Code:**
```R
# Plotting age as a line graph
plot(empinfo$age, type="l", main="Age of employees", xlab="empid", ylab="age in years", col="green")
```

**What the diagram looks like:**
It's a jagged green line going up and down across the screen. The X-axis is just the employee ID (1 to 15) and the Y-axis is their age.

orbit-widget
```json
{
  "kind": "chart",
  "title": "Age of Employees (Line Plot)",
  "chartType": "line",
  "labels": ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"],
  "series": [
    {
      "name": "Age",
      "values": [30, 37, 45, 32, 50, 60, 35, 32, 34, 43, 32, 30, 43, 50, 60]
    }
  ],
  "unit": "Years"
}
```

---

### 2. Pie Chart 🍕
This shows the split between Male and Female employees. Based on the `gender` vector in your PDF, we have 8 males and 7 females.

**The Code:**
```R
# Creating a frequency table for gender and plotting as a pie chart
table1 = table(empinfo$gender) 
pie(table1)
```

**What the diagram looks like:**
A circle sliced into two parts: one slightly larger part for "male" and one for "female".

orbit-widget
```json
{
  "kind": "chart",
  "title": "Gender Distribution (Pie Chart)",
  "chartType": "pie",
  "labels": ["Male", "Female"],
  "series": [
    {
      "name": "Count",
      "values": [8, 7]
    }
  ],
  "unit": "Employees"
}
```

---

### 3. Grouped Bar Plot 📊
This is the "heavy" one. It shows how many Males vs Females are "Staff" vs "Faculty".

**The Code:**
```R
# Table for Gender vs Status
table3 = table(empinfo$gender, empinfo$status) 
barplot(table3, beside=T, xlim=c(1,15), ylim=c(0,5), col=c("green","yellow")) 
legend("topright", legend=rownames(table3), fill=c("green","yellow"), bty="n")
```

**What the diagram looks like:**
You'll see two groups of bars. One group for "Staff" (Male bar & Female bar) and one group for "Faculty" (Male bar & Female bar).

orbit-widget
```json
{
  "kind": "chart",
  "title": "Gender vs Status (Bar Plot)",
  "chartType": "bar",
  "labels": ["Staff", "Faculty"],
  "series": [
    {
      "name": "Male",
      "values": [5, 3]
    },
    {
      "name": "Female",
      "values": [3, 4]
    }
  ],
  "unit": "Count"
}
```

---

### 4. Box Plot 📦
This compares the age distribution of "Staff" versus "Faculty". It helps you see who is generally older.

**The Code:**
```R
# Plotting Age based on Status
boxplot(empinfo$age ~ empinfo$status, col=c("yellow","green"))
```

**What the diagram looks like:**
Two boxes side-by-side. The "box" shows where most of the ages fall, and the line inside the box is the median age.

orbit-widget
```json
{
  "kind": "chart",
  "title": "Age Distribution by Status (Box Plot)",
  "chartType": "box",
  "labels": ["Staff", "Faculty"],
  "series": [
    {
      "name": "Age",
      "samples": [
        [30, 32, 35, 32, 43, 30, 50], 
        [37, 45, 50, 60, 34, 32, 43, 60]
      ]
    }
  ],
  "unit": "Years"
}
```