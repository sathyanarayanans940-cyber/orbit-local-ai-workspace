module.exports={kind:'docx',title:'Dynamic Programming Recurrence Rules',style:{theme:'ocean',font:'sans',pageSize:'A4'},blocks:[
 {type:'paragraph',text:'Each expression defines one case of the recurrence. Its condition is shown directly below the expression, followed by a short explanation.'},
 {type:'heading',text:'Knapsack recurrence',level:2},
 // Legacy model spelling from the reported formatting pattern: padded spaces.
 {type:'formula',text:'dp[i][c] = 0                         if i = 0',caption:'No items means no revenue.'},
 {type:'formula',text:'dp[i][c] = dp[i-1][c]\t\tif w[i] > c',caption:'The item does not fit, so it cannot be selected.'},
 {type:'formula',text:'dp[i][c] = max( dp[i-1][c],  dp[i-1][c - w[i]] + v[i] )     if w[i] <= c',caption:'Choose the better of skipping the item or taking it and adding its revenue.'},
 {type:'paragraph',text:'These conditions select the appropriate case without changing the formula or its mathematical meaning.'},
 {type:'heading',text:'A different piecewise rule',level:2},
 {type:'formula',text:'f(x) = x²',condition:'if x ≥ 0',caption:'The same layout applies to other subjects.'},
 {type:'formula',text:'f(x) = −x',condition:'if x < 0'},
 {type:'heading',text:'Ordinary calculation steps',level:2},
 {type:'formula',text:'F = m × a\n= 2 × 3\n= 6 N',caption:'Equality steps keep their original line layout.'},
]};
